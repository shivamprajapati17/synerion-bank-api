const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');

// PUT /api/profile/update - Update profile information
router.put('/update', authenticate, async (req, res) => {
  try {
    const { fullName, address, city, state, pincode, occupation } = req.body;

    const result = await query(
      `UPDATE users
       SET full_name = COALESCE($1, full_name),
           address = COALESCE($2, address),
           city = COALESCE($3, city),
           state = COALESCE($4, state),
           pincode = COALESCE($5, pincode),
           occupation = COALESCE($6, occupation),
           updated_at = NOW()
       WHERE id = $7
       RETURNING id, full_name, email, phone, address, city, state, pincode, occupation`,
      [fullName, address, city, state, pincode, occupation, req.userId]
    );

    res.json({
      success: true,
      message: 'Profile updated successfully!',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('[Profile] Update error:', error.message);
    res.status(500).json({ success: false, message: 'Profile update failed' });
  }
});

// ============================================
// NOTIFICATIONS
// ============================================

// GET /api/profile/notifications - Get notifications
router.get('/notifications', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const result = await query(
      `SELECT * FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.userId, limit, offset]
    );

    const unreadResult = await query(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND is_read = false',
      [req.userId]
    );

    res.json({
      success: true,
      count: result.rows.length,
      unreadCount: parseInt(unreadResult.rows[0].count),
      data: result.rows,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch notifications' });
  }
});

// PUT /api/profile/notifications/:id/read - Mark notification as read
router.put('/notifications/:id/read', authenticate, async (req, res) => {
  try {
    await query(
      'UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    res.json({ success: true, message: 'Notification marked as read' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update notification' });
  }
});

// PUT /api/profile/notifications/read-all - Mark all notifications as read
router.put('/notifications/read-all', authenticate, async (req, res) => {
  try {
    await query(
      'UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false',
      [req.userId]
    );
    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update notifications' });
  }
});

// ============================================
// COMPLAINTS
// ============================================

// GET /api/profile/complaints - Get user's complaints
router.get('/complaints', authenticate, async (req, res) => {
  try {
    const result = await query(
      `SELECT c.*, cc.name as category_name
       FROM complaints c
       JOIN complaint_categories cc ON c.category_id = cc.id
       WHERE c.user_id = $1
       ORDER BY c.created_at DESC`,
      [req.userId]
    );
    res.json({ success: true, count: result.rows.length, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch complaints' });
  }
});

// GET /api/profile/complaint-categories - Get complaint categories
router.get('/complaint-categories', authenticate, async (req, res) => {
  try {
    const result = await query('SELECT * FROM complaint_categories ORDER BY id');
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch categories' });
  }
});

// POST /api/profile/complaints - Submit a complaint
router.post('/complaints', authenticate, async (req, res) => {
  try {
    const { categoryCode, subject, description, priority } = req.body;

    if (!categoryCode || !subject || !description) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const catResult = await query('SELECT id FROM complaint_categories WHERE code = $1', [categoryCode]);
    if (catResult.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid complaint category' });
    }

    // Generate reference
    const ref = 'CMP-' + Date.now().toString(36).toUpperCase();

    const result = await query(
      `INSERT INTO complaints (user_id, category_id, complaint_reference, subject, description, priority)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.userId, catResult.rows[0].id, ref, subject, description, priority || 'medium']
    );

    await query(
      `INSERT INTO notifications (user_id, title, message, type, category, reference_id, reference_type)
       VALUES ($1, 'Complaint Registered', $2, 'info', 'general', $3, 'complaint')`,
      [req.userId, `Your complaint (${ref}) has been registered. We'll get back to you soon.`, ref]
    );

    res.status(201).json({
      success: true,
      message: 'Your complaint has been registered. We will get back to you soon.',
      data: result.rows[0],
    });
  } catch (error) {
    console.error('[Profile] Complaint error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to submit complaint' });
  }
});

// GET /api/profile/dashboard - Full dashboard data
router.get('/dashboard', authenticate, async (req, res) => {
  try {
    // Account summary
    const accountsResult = await query(
      `SELECT COUNT(*) as total_accounts, SUM(balance) as total_balance
       FROM accounts WHERE user_id = $1 AND status = 'active'`,
      [req.userId]
    );

    // Active loans
    const loansResult = await query(
      `SELECT COUNT(*) as total_loans,
              SUM(CASE WHEN status = 'active' OR status = 'approved' OR status = 'disbursed' THEN loan_amount ELSE 0 END) as total_loan_amount
       FROM loans WHERE user_id = $1 AND status NOT IN ('closed', 'rejected')`,
      [req.userId]
    );

    // Investment summary
    const invResult = await query(
      `SELECT COUNT(*) as total_investments,
              SUM(amount) as total_invested,
              SUM(COALESCE(current_value, amount)) as total_current_value
       FROM investments WHERE user_id = $1 AND status = 'active'`,
      [req.userId]
    );

    // Recent transactions (last 5)
    const txnResult = await query(
      `SELECT t.*, tt.name as transaction_type_name, tt.code as transaction_type_code
       FROM transactions t
       JOIN transaction_types tt ON t.transaction_type_id = tt.id
       WHERE t.initiated_by = $1
       ORDER BY t.created_at DESC
       LIMIT 5`,
      [req.userId]
    );

    // Pending complaints
    const compResult = await query(
      "SELECT COUNT(*) as count FROM complaints WHERE user_id = $1 AND status IN ('open', 'in_progress')",
      [req.userId]
    );

    res.json({
      success: true,
      data: {
        accounts: {
          count: parseInt(accountsResult.rows[0].total_accounts) || 0,
          totalBalance: parseFloat(accountsResult.rows[0].total_balance) || 0,
        },
        loans: {
          count: parseInt(loansResult.rows[0].total_loans) || 0,
          totalAmount: parseFloat(loansResult.rows[0].total_loan_amount) || 0,
        },
        investments: {
          count: parseInt(invResult.rows[0].total_investments) || 0,
          totalInvested: parseFloat(invResult.rows[0].total_invested) || 0,
          totalCurrentValue: parseFloat(invResult.rows[0].total_current_value) || 0,
        },
        recentTransactions: txnResult.rows.map(t => ({
          ...t,
          amount: parseFloat(t.amount),
          balance_before: t.balance_before ? parseFloat(t.balance_before) : null,
          balance_after: t.balance_after ? parseFloat(t.balance_after) : null,
        })),
        pendingComplaints: parseInt(compResult.rows[0].count) || 0,
      },
    });
  } catch (error) {
    console.error('[Profile] Dashboard error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch dashboard data' });
  }
});

module.exports = router;
