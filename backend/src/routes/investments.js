const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');

// GET /api/investments - Get user's investment portfolio
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await query(
      `SELECT i.*, it.name as investment_type, it.code as investment_type_code,
              it.expected_returns, it.risk_level, it.min_investment
       FROM investments i
       JOIN investment_types it ON i.investment_type_id = it.id
       WHERE i.user_id = $1
       ORDER BY i.created_at DESC`,
      [req.userId]
    );

    const totalInvested = result.rows.reduce((sum, inv) => sum + parseFloat(inv.amount), 0);
    const totalCurrentValue = result.rows.reduce((sum, inv) => sum + (inv.current_value ? parseFloat(inv.current_value) : parseFloat(inv.amount)), 0);

    res.json({
      success: true,
      count: result.rows.length,
      data: {
        summary: {
          totalInvested,
          totalCurrentValue,
          totalReturns: totalCurrentValue - totalInvested,
          returnPercent: totalInvested > 0 ? ((totalCurrentValue - totalInvested) / totalInvested * 100).toFixed(2) : 0,
        },
        investments: result.rows.map(i => ({
          ...i,
          amount: parseFloat(i.amount),
          current_value: i.current_value ? parseFloat(i.current_value) : null,
          interest_rate: i.interest_rate ? parseFloat(i.interest_rate) : null,
          min_investment: parseFloat(i.min_investment),
        })),
      },
    });
  } catch (error) {
    console.error('[Investments] List error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch investments' });
  }
});

// GET /api/investments/types - Get available investment types
router.get('/types', authenticate, async (req, res) => {
  try {
    const result = await query('SELECT * FROM investment_types ORDER BY id');
    res.json({
      success: true,
      data: result.rows.map(i => ({
        ...i,
        min_investment: parseFloat(i.min_investment),
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch investment types' });
  }
});

// POST /api/investments/create - Create new investment
router.post('/create', authenticate, async (req, res) => {
  try {
    const { investmentTypeCode, accountId, amount, tenureMonths, riskProfile } = req.body;

    if (!investmentTypeCode || !accountId || !amount) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const investAmount = parseFloat(amount);
    if (investAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid amount' });
    }

    // Verify account
    const accResult = await query(
      'SELECT id, balance FROM accounts WHERE id = $1 AND user_id = $2 AND status = $3',
      [accountId, req.userId, 'active']
    );

    if (accResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Account not found or inactive' });
    }

    if (parseFloat(accResult.rows[0].balance) < investAmount) {
      return res.status(400).json({ success: false, message: 'Insufficient balance' });
    }

    // Get investment type
    const invTypeResult = await query('SELECT * FROM investment_types WHERE code = $1', [investmentTypeCode]);
    if (invTypeResult.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid investment type' });
    }

    const invType = invTypeResult.rows[0];

    if (investAmount < parseFloat(invType.min_investment)) {
      return res.status(400).json({
        success: false,
        message: `Minimum investment for ${invType.name} is INR ${parseFloat(invType.min_investment).toLocaleString('en-IN')}`,
      });
    }

    // Determine interest rate based on type
    let interestRate = 0;
    let maturityDate = null;
    let tenure = parseInt(tenureMonths) || 12;

    if (['FD', 'TFD', 'RD'].includes(investmentTypeCode)) {
      // For FDs, use a fixed rate based on tenure
      interestRate = tenure >= 60 ? 7.5 : tenure >= 36 ? 7.0 : tenure >= 12 ? 6.5 : 5.5;
      if (investmentTypeCode === 'TFD') interestRate = 7.0;
      maturityDate = new Date();
      maturityDate.setMonth(maturityDate.getMonth() + tenure);
    }

    // Generate reference
    const refPrefix = invType.code + '-' + Date.now().toString(36).toUpperCase();

    // Create investment
    const result = await query(
      `INSERT INTO investments (user_id, investment_type_id, account_id, investment_reference,
        amount, current_value, interest_rate, tenure_months, maturity_date, risk_profile)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [req.userId, invType.id, accountId, refPrefix, investAmount, investAmount,
       interestRate || null, tenure, maturityDate, riskProfile || 'moderate']
    );

    // Debit from account
    await query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [investAmount, accountId]);

    // Transaction record
    const refResult = await query("SELECT generate_txn_reference() as ref");
    await query(
      `INSERT INTO transactions (transaction_reference, from_account_id, transaction_type_id,
        amount, balance_before, balance_after, description, status, initiated_by, completed_at)
       VALUES ($1, $2, (SELECT id FROM transaction_types WHERE code = 'INV'), $3, $4, $5,
        $6, 'completed', $7, NOW())`,
      [refResult.rows[0].ref, accountId, investAmount,
       parseFloat(accResult.rows[0].balance), parseFloat(accResult.rows[0].balance) - investAmount,
       `Investment in ${invType.name} (${refPrefix})`, req.userId]
    );

    // Notification
    await query(
      `INSERT INTO notifications (user_id, title, message, type, category, reference_id, reference_type)
       VALUES ($1, 'Investment Made', $2, 'success', 'investment', $3, 'investment')`,
      [req.userId, `INR ${investAmount.toLocaleString('en-IN')} invested in ${invType.name}. Ref: ${refPrefix}`, refPrefix]
    );

    res.status(201).json({
      success: true,
      message: `Investment of INR ${investAmount.toLocaleString('en-IN')} in ${invType.name} is successful!`,
      data: {
        ...result.rows[0],
        amount: parseFloat(result.rows[0].amount),
        current_value: result.rows[0].current_value ? parseFloat(result.rows[0].current_value) : null,
      },
    });
  } catch (error) {
    console.error('[Investments] Create error:', error.message);
    res.status(500).json({ success: false, message: 'Investment creation failed' });
  }
});

// GET /api/investments/:id - Get investment details
router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await query(
      `SELECT i.*, it.name as investment_type, it.code as investment_type_code,
              it.expected_returns, it.risk_level
       FROM investments i
       JOIN investment_types it ON i.investment_type_id = it.id
       WHERE i.id = $1 AND i.user_id = $2`,
      [req.params.id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Investment not found' });
    }

    res.json({
      success: true,
      data: {
        ...result.rows[0],
        amount: parseFloat(result.rows[0].amount),
        current_value: result.rows[0].current_value ? parseFloat(result.rows[0].current_value) : null,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch investment details' });
  }
});

module.exports = router;
