const express = require('express');
const router = express.Router();
const { query, getClient } = require('../config/database');
const { authenticate } = require('../middleware/auth');

// GET /api/transactions - Get all transactions for user
router.get('/', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const result = await query(
      `SELECT t.*, tt.name as transaction_type_name, tt.code as transaction_type_code,
              COALESCE(from_acc.account_number, '') as from_account,
              COALESCE(to_acc.account_number, '') as to_account
       FROM transactions t
       JOIN transaction_types tt ON t.transaction_type_id = tt.id
       LEFT JOIN accounts from_acc ON t.from_account_id = from_acc.id
       LEFT JOIN accounts to_acc ON t.to_account_id = to_acc.id
       WHERE t.initiated_by = $1
       ORDER BY t.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.userId, limit, offset]
    );

    // Get total count
    const countResult = await query(
      'SELECT COUNT(*) as total FROM transactions WHERE initiated_by = $1',
      [req.userId]
    );

    res.json({
      success: true,
      count: result.rows.length,
      total: parseInt(countResult.rows[0].total),
      page,
      limit,
      data: result.rows.map(t => ({
        ...t,
        amount: parseFloat(t.amount),
        fee: parseFloat(t.fee),
        balance_before: t.balance_before ? parseFloat(t.balance_before) : null,
        balance_after: t.balance_after ? parseFloat(t.balance_after) : null,
      })),
    });
  } catch (error) {
    console.error('[Transactions] List error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transactions',
    });
  }
});

// POST /api/transactions/transfer - Transfer funds
router.post('/transfer', authenticate, async (req, res) => {
  const client = await getClient();
  try {
    const { fromAccountId, toAccountNumber, ifscCode, amount, remarks, transferType } = req.body;

    if (!fromAccountId || !toAccountNumber || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Please provide fromAccountId, toAccountNumber, and amount',
      });
    }

    const transferAmount = parseFloat(amount);
    if (transferAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be greater than zero',
      });
    }

    await client.query('BEGIN');

    // Verify source account
    const fromResult = await client.query(
      'SELECT id, account_number, balance, status FROM accounts WHERE id = $1 AND user_id = $2',
      [fromAccountId, req.userId]
    );

    if (fromResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Source account not found',
      });
    }

    const fromAccount = fromResult.rows[0];

    if (fromAccount.status !== 'active') {
      await client.query('ROLLBACK');
      return res.status(403).json({
        success: false,
        message: 'Source account is not active',
      });
    }

    if (parseFloat(fromAccount.balance) < transferAmount) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance',
      });
    }

    // Find destination account
    const toResult = await client.query(
      'SELECT id, account_number, balance FROM accounts WHERE account_number = $1',
      [toAccountNumber]
    );

    if (toResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Destination account not found',
      });
    }

    const toAccount = toResult.rows[0];

    // Generate transaction reference
    const refResult = await client.query("SELECT generate_txn_reference() as ref");
    const txnRef = refResult.rows[0].ref;

    // Get transaction type
    const txnTypeResult = await client.query(
      `SELECT id FROM transaction_types WHERE code = $1`,
      [transferType || 'INT']
    );
    const txnTypeId = txnTypeResult.rows[0]?.id || 5;

    const fromBalanceBefore = parseFloat(fromAccount.balance);
    const toBalanceBefore = parseFloat(toAccount.balance);
    const fee = 0;

    // Debit source
    await client.query(
      'UPDATE accounts SET balance = balance - $1 WHERE id = $2',
      [transferAmount, fromAccountId]
    );

    // Credit destination
    await client.query(
      'UPDATE accounts SET balance = balance + $1 WHERE id = $2',
      [transferAmount, toAccount.id]
    );

    // Create transaction record (debit for sender)
    const txnResult = await client.query(
      `INSERT INTO transactions (transaction_reference, from_account_id, to_account_id, transaction_type_id,
        amount, fee, balance_before, balance_after, description, status, initiated_by, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'completed', $10, NOW())
       RETURNING *`,
      [txnRef + '-DR', fromAccountId, toAccount.id, txnTypeId, transferAmount, fee,
       fromBalanceBefore, fromBalanceBefore - transferAmount, remarks || 'Fund Transfer', req.userId]
    );

    // Create companion credit record (for the receiver's perspective)
    await client.query(
      `INSERT INTO transactions (transaction_reference, from_account_id, to_account_id, transaction_type_id,
        amount, fee, balance_before, balance_after, description, status, initiated_by, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'completed', $10, NOW())`,
      [txnRef + '-CR', fromAccountId, toAccount.id, txnTypeId, transferAmount, fee,
       toBalanceBefore, toBalanceBefore + transferAmount, remarks || 'Fund Transfer', req.userId]
    );

    // Notifications
    await client.query(
      `INSERT INTO notifications (user_id, title, message, type, category, reference_id, reference_type)
       VALUES ($1, 'Debit Alert', $2, 'warning', 'transaction', $3, 'transaction')`,
      [req.userId, `INR ${transferAmount.toLocaleString('en-IN')} debited from ${fromAccount.account_number}. Ref: ${txnRef}`, txnRef]
    );

    // Notification for receiver
    const toUserResult = await client.query('SELECT user_id FROM accounts WHERE id = $1', [toAccount.id]);
    if (toUserResult.rows.length > 0 && toUserResult.rows[0].user_id !== req.userId) {
      await client.query(
        `INSERT INTO notifications (user_id, title, message, type, category, reference_id, reference_type)
         VALUES ($1, 'Credit Alert', $2, 'success', 'transaction', $3, 'transaction')`,
        [toUserResult.rows[0].user_id,
         `INR ${transferAmount.toLocaleString('en-IN')} credited to your account. Ref: ${txnRef}`,
         txnRef]
      );
    }

    // Audit log
    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values, ip_address)
       VALUES ($1, 'TRANSFER', 'transaction', $2, $3, $4)`,
      [req.userId, txnRef,
       JSON.stringify({ from: fromAccount.account_number, to: toAccount.account_number, amount: transferAmount }),
       req.ip]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `Transfer of INR ${transferAmount.toLocaleString('en-IN')} completed successfully!`,
      data: {
        transaction: {
          ...txnResult.rows[0],
          amount: parseFloat(txnResult.rows[0].amount),
          balance_before: parseFloat(txnResult.rows[0].balance_before),
          balance_after: parseFloat(txnResult.rows[0].balance_after),
        },
        fromAccount: fromAccount.account_number,
        toAccount: toAccount.account_number,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Transactions] Transfer error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Transfer failed. Please try again.',
    });
  } finally {
    client.release();
  }
});

// POST /api/transactions/bill-pay - Pay a bill
router.post('/bill-pay', authenticate, async (req, res) => {
  try {
    const { accountId, billCategoryCode, billerName, billerAccountNumber, amount } = req.body;

    if (!accountId || !billCategoryCode || !billerName || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
      });
    }

    const billAmount = parseFloat(amount);
    if (billAmount <= 0) {
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

    if (parseFloat(accResult.rows[0].balance) < billAmount) {
      return res.status(400).json({ success: false, message: 'Insufficient balance' });
    }

    // Get category
    const catResult = await query('SELECT id, name FROM bill_categories WHERE code = $1', [billCategoryCode]);
    if (catResult.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid bill category' });
    }

    // Generate reference
    const refResult = await query("SELECT generate_txn_reference() as ref");
    const txnRef = refResult.rows[0].ref;

    // Get bill payment transaction type
    const txnTypeResult = await query("SELECT id FROM transaction_types WHERE code = 'BIL'");
    const txnTypeId = txnTypeResult.rows[0]?.id || 9;

    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Debit account
      await client.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [billAmount, accountId]);

      // Create transaction
      await client.query(
        `INSERT INTO transactions (transaction_reference, from_account_id, transaction_type_id,
          amount, balance_before, balance_after, description, status, initiated_by, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', $8, NOW())`,
        [txnRef, accountId, txnTypeId, billAmount,
         parseFloat(accResult.rows[0].balance), parseFloat(accResult.rows[0].balance) - billAmount,
         `Bill payment: ${billerName}`, req.userId]
      );

      // Record bill payment
      await client.query(
        `INSERT INTO bill_payments (user_id, account_id, bill_category_id, biller_name, biller_account_number, amount, transaction_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, (SELECT id FROM transactions WHERE transaction_reference = $7), 'completed')`,
        [req.userId, accountId, catResult.rows[0].id, billerName, billerAccountNumber || null, billAmount, txnRef]
      );

      await client.query('COMMIT');

      res.json({
        success: true,
        message: `Bill payment of INR ${billAmount.toLocaleString('en-IN')} to ${billerName} completed!`,
        data: { transactionReference: txnRef },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[Transactions] Bill pay error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Bill payment failed',
    });
  }
});

// GET /api/transactions/bill-categories - Get bill categories
router.get('/bill-categories', authenticate, async (req, res) => {
  try {
    const result = await query('SELECT * FROM bill_categories ORDER BY id');
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch categories' });
  }
});

// Beneficiaries

// GET /api/transactions/beneficiaries - List beneficiaries
router.get('/beneficiaries', authenticate, async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM beneficiaries WHERE user_id = $1 AND is_active = true ORDER BY created_at DESC',
      [req.userId]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch beneficiaries' });
  }
});

// POST /api/transactions/beneficiaries - Add beneficiary
router.post('/beneficiaries', authenticate, async (req, res) => {
  try {
    const { beneficiaryName, accountNumber, ifscCode, bankName } = req.body;

    if (!beneficiaryName || !accountNumber || !ifscCode) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const result = await query(
      `INSERT INTO beneficiaries (user_id, beneficiary_name, account_number, ifsc_code, bank_name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.userId, beneficiaryName, accountNumber, ifscCode, bankName || '']
    );

    res.status(201).json({
      success: true,
      message: 'Beneficiary added successfully',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('[Transactions] Add beneficiary error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to add beneficiary' });
  }
});

// DELETE /api/transactions/beneficiaries/:id - Remove beneficiary
router.delete('/beneficiaries/:id', authenticate, async (req, res) => {
  try {
    await query(
      'UPDATE beneficiaries SET is_active = false WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    res.json({ success: true, message: 'Beneficiary removed' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to remove beneficiary' });
  }
});

module.exports = router;
