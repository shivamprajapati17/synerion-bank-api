const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'synerion_bank_super_secret_key_2026!';
const JWT_EXPIRE = process.env.JWT_EXPIRE || '7d';

// POST /api/auth/register - Register a new user
router.post('/register', async (req, res) => {
  try {
    const { fullName, email, phone, password, dateOfBirth, gender, address, city, state, pincode } = req.body;

    // Basic validation
    if (!fullName || !email || !phone || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields: fullName, email, phone, password',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters',
      });
    }

    // Check if user exists
    const existingUser = await query(
      'SELECT id FROM users WHERE email = $1 OR phone = $2',
      [email, phone]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'User with this email or phone already exists',
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create user
    const result = await query(
      `INSERT INTO users (full_name, email, phone, password_hash, date_of_birth, gender, address, city, state, pincode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, full_name, email, phone, created_at`,
      [fullName, email, phone, passwordHash, dateOfBirth || null, gender || null, address || null, city || null, state || null, pincode || null]
    );

    const user = result.rows[0];

    // Generate JWT token
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRE });

    res.status(201).json({
      success: true,
      message: 'Registration successful! Welcome to Synerion Bank.',
      data: {
        user: {
          id: user.id,
          fullName: user.full_name,
          email: user.email,
          phone: user.phone,
        },
        token,
      },
    });
  } catch (error) {
    console.error('[Auth] Register error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Registration failed. Please try again.',
    });
  }
});

// POST /api/auth/login - Login user
router.post('/login', async (req, res) => {
  try {
    const { email, phone, password } = req.body;

    if ((!email && !phone) || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email/phone and password',
      });
    }

    // Find user by email or phone
    const result = await query(
      'SELECT id, full_name, email, phone, password_hash, is_kyc_completed, is_active, profile_image_url FROM users WHERE email = $1 OR phone = $2',
      [email || '', phone || '']
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated. Please contact support.',
      });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    // Generate JWT token
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRE });

    // Log login
    await query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address)
       VALUES ($1, 'LOGIN', 'user', $2, $3)`,
      [user.id, user.id, req.ip]
    );

    res.json({
      success: true,
      message: 'Login successful! Welcome back.',
      data: {
        user: {
          id: user.id,
          fullName: user.full_name,
          email: user.email,
          phone: user.phone,
          isKycCompleted: user.is_kyc_completed,
          profileImage: user.profile_image_url,
        },
        token,
      },
    });
  } catch (error) {
    console.error('[Auth] Login error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Login failed. Please try again.',
    });
  }
});

// GET /api/auth/me - Get current user profile
router.get('/me', authenticate, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, full_name, email, phone, date_of_birth, gender, address, city, state, pincode,
              occupation, annual_income, is_kyc_completed, is_active, profile_image_url, created_at, updated_at
       FROM users WHERE id = $1`,
      [req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const user = result.rows[0];

    // Get user accounts
    const accountsResult = await query(
      `SELECT a.id, a.account_number, a.ifsc_code, a.balance, a.status, at.name as account_type
       FROM accounts a
       JOIN account_types at ON a.account_type_id = at.id
       WHERE a.user_id = $1 AND a.status = 'active'`,
      [req.userId]
    );

    // Get unread notifications count
    const notifResult = await query(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND is_read = false',
      [req.userId]
    );

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          fullName: user.full_name,
          email: user.email,
          phone: user.phone,
          dateOfBirth: user.date_of_birth,
          gender: user.gender,
          address: user.address,
          city: user.city,
          state: user.state,
          pincode: user.pincode,
          occupation: user.occupation,
          annualIncome: user.annual_income,
          isKycCompleted: user.is_kyc_completed,
          isActive: user.is_active,
          profileImage: user.profile_image_url,
          createdAt: user.created_at,
        },
        accounts: accountsResult.rows.map(a => ({
          id: a.id,
          accountNumber: a.account_number,
          ifscCode: a.ifsc_code,
          balance: parseFloat(a.balance),
          status: a.status,
          accountType: a.account_type,
        })),
        unreadNotifications: parseInt(notifResult.rows[0].count),
      },
    });
  } catch (error) {
    console.error('[Auth] Get profile error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch profile',
    });
  }
});

// POST /api/auth/kyc - Submit KYC details
router.post('/kyc', authenticate, async (req, res) => {
  try {
    const { aadhaarNumber, panNumber, occupation, annualIncome } = req.body;

    if (!aadhaarNumber) {
      return res.status(400).json({
        success: false,
        message: 'Aadhaar number is required for KYC',
      });
    }

    await query(
      `UPDATE users
       SET aadhaar_number = $1, pan_number = $2, occupation = $3, annual_income = $4, is_kyc_completed = TRUE, updated_at = NOW()
       WHERE id = $5`,
      [aadhaarNumber, panNumber || null, occupation || null, annualIncome || null, req.userId]
    );

    res.json({
      success: true,
      message: 'KYC completed successfully! You can now open accounts.',
    });
  } catch (error) {
    console.error('[Auth] KYC error:', error.message);
    res.status(500).json({
      success: false,
      message: 'KYC verification failed',
    });
  }
});

// POST /api/auth/change-password - Change password
router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide current and new password',
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters',
      });
    }

    const result = await query('SELECT password_hash FROM users WHERE id = $1', [req.userId]);
    const isMatch = await bcrypt.compare(currentPassword, result.rows[0].password_hash);

    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect',
      });
    }

    const salt = await bcrypt.genSalt(10);
    const newHash = await bcrypt.hash(newPassword, salt);

    await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, req.userId]);

    res.json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (error) {
    console.error('[Auth] Change password error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to change password',
    });
  }
});

module.exports = router;
