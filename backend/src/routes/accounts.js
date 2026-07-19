const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');

// GET /api/accounts - List all accounts for the user
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await query(
      `SELECT a.id, a.account_number, a.ifsc_code, a.balance, a.status, a.is_joint,
              a.joint_holder_name, a.opened_at, at.name as account_type, at.code as account_type_code,
              at.interest_rate, at.min_balance
       FROM accounts a
       JOIN account_types at ON a.account_type_id = at.id
       WHERE a.user_id = $1
       ORDER BY a.created_at DESC`,
      [req.userId]
    );

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows.map(a => ({
        ...a,
        balance: parseFloat(a.balance),
        interest_rate: parseFloat(a.interest_rate),
        min_balance: parseFloat(a.min_balance),
      })),
    });
  } catch (error) {
    console.error('[Accounts] List error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch accounts',
    });
  }
});

// GET /api/accounts/account-types - Get available account types
router.get('/account-types', authenticate, async (req, res) => {
  try {
    const result = await query('SELECT * FROM account_types ORDER BY id');
    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('[Accounts] Types error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch account types',
    });
  }
});

// POST /api/accounts/open - Open a new account
router.post('/open', authenticate, async (req, res) => {
  try {
    const { accountTypeCode, isJoint, jointHolderName } = req.body;

    // Check KYC
    const userResult = await query(
      'SELECT is_kyc_completed FROM users WHERE id = $1',
      [req.userId]
    );

    if (!userResult.rows[0].is_kyc_completed) {
      return res.status(403).json({
        success: false,
        message: 'Please complete KYC verification before opening an account',
      });
    }

    // Get account type
    const typeResult = await query(
      'SELECT id, code, min_balance FROM account_types WHERE code = $1',
      [accountTypeCode]
    );

    if (typeResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid account type',
      });
    }

    const accountType = typeResult.rows[0];

    // Check if user already has this type of account
    const existingResult = await query(
      `SELECT a.id FROM accounts a
       JOIN account_types at ON a.account_type_id = at.id
       WHERE a.user_id = $1 AND at.code = $2 AND a.status = 'active'`,
      [req.userId, accountTypeCode]
    );

    if (existingResult.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: `You already have an active ${accountTypeCode} account`,
      });
    }

    // Generate account number
    const accNumResult = await query("SELECT generate_account_number() as acc_num");
    const accountNumber = accNumResult.rows[0].acc_num;

    // Create account
    const result = await query(
      `INSERT INTO accounts (user_id, account_type_id, account_number, is_joint, joint_holder_name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, account_number, ifsc_code, balance, is_joint, joint_holder_name, opened_at`,
      [req.userId, accountType.id, accountNumber, isJoint || false, jointHolderName || null]
    );

    // Create notification
    await query(
      `INSERT INTO notifications (user_id, title, message, type, category, reference_id, reference_type)
       VALUES ($1, 'Account Opened', $2, 'success', 'account', $3, 'account')`,
      [req.userId, `Your ${accountTypeCode} account (${accountNumber}) has been opened successfully!`, accountNumber]
    );

    // Audit log
    await query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values)
       VALUES ($1, 'ACCOUNT_OPENED', 'account', $2, $3)`,
      [req.userId, accountNumber, JSON.stringify({ accountType: accountTypeCode, isJoint: isJoint || false })]
    );

    res.status(201).json({
      success: true,
      message: `Your ${accountTypeCode} account has been opened successfully!`,
      data: {
        account: {
          ...result.rows[0],
          accountType: accountTypeCode,
        },
      },
    });
  } catch (error) {
    console.error('[Accounts] Open error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to open account',
    });
  }
});

// GET /api/accounts/:id - Get account details with transactions
router.get('/:id', authenticate, async (req, res) => {
  try {
    const accountResult = await query(
      `SELECT a.*, at.name as account_type, at.code as account_type_code, at.interest_rate
       FROM accounts a
       JOIN account_types at ON a.account_type_id = at.id
       WHERE a.id = $1 AND a.user_id = $2`,
      [req.params.id, req.userId]
    );

    if (accountResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Account not found',
      });
    }

    // Get recent transactions
    const txnResult = await query(
      `SELECT t.*, tt.name as transaction_type_name, tt.code as transaction_type_code,
              COALESCE(from_acc.account_number, '') as from_account,
              COALESCE(to_acc.account_number, '') as to_account
       FROM transactions t
       JOIN transaction_types tt ON t.transaction_type_id = tt.id
       LEFT JOIN accounts from_acc ON t.from_account_id = from_acc.id
       LEFT JOIN accounts to_acc ON t.to_account_id = to_acc.id
       WHERE (t.from_account_id = $1 OR t.to_account_id = $1)
       ORDER BY t.created_at DESC
       LIMIT 20`,
      [req.params.id]
    );

    res.json({
      success: true,
      data: {
        account: {
          ...accountResult.rows[0],
          balance: parseFloat(accountResult.rows[0].balance),
          interest_rate: parseFloat(accountResult.rows[0].interest_rate),
        },
        recentTransactions: txnResult.rows.map(t => ({
          ...t,
          amount: parseFloat(t.amount),
          balance_before: t.balance_before ? parseFloat(t.balance_before) : null,
          balance_after: t.balance_after ? parseFloat(t.balance_after) : null,
        })),
      },
    });
  } catch (error) {
    console.error('[Accounts] Detail error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch account details',
    });
  }
});

// GET /api/accounts/:id/statement - Get account statement (last 30 days by default)
router.get('/:id/statement', authenticate, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;

    const result = await query(
      `SELECT t.transaction_reference, t.amount, t.balance_before, t.balance_after,
              t.description, t.status, t.remarks, t.created_at,
              tt.name as type, tt.code as type_code,
              COALESCE(from_acc.account_number, '') as from_account,
              COALESCE(to_acc.account_number, '') as to_account
       FROM transactions t
       JOIN transaction_types tt ON t.transaction_type_id = tt.id
       LEFT JOIN accounts from_acc ON t.from_account_id = from_acc.id
       LEFT JOIN accounts to_acc ON t.to_account_id = to_acc.id
       WHERE (t.from_account_id = $1 OR t.to_account_id = $1)
         AND t.created_at >= NOW() - ($2 || ' days')::INTERVAL
       ORDER BY t.created_at DESC`,
      [req.params.id, days]
    );

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows.map(t => ({
        ...t,
        amount: parseFloat(t.amount),
        balance_before: t.balance_before ? parseFloat(t.balance_before) : null,
        balance_after: t.balance_after ? parseFloat(t.balance_after) : null,
      })),
    });
  } catch (error) {
    console.error('[Accounts] Statement error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statement',
    });
  }
});

module.exports = router;
