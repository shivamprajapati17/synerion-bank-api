const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.',
      });
    }

    const token = authHeader.split(' ')[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'synerion_bank_super_secret_key_2026!');

    const result = await query('SELECT id, full_name, email, phone, is_kyc_completed, is_active FROM users WHERE id = $1', [decoded.userId]);

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token. User not found.',
      });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated. Please contact support.',
      });
    }

    req.user = user;
    req.userId = user.id;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token.',
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired. Please login again.',
      });
    }
    console.error('[Auth] Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error.',
    });
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      req.userId = null;
      return next();
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'synerion_bank_super_secret_key_2026!');

    const result = await query('SELECT id, full_name, email FROM users WHERE id = $1 AND is_active = true', [decoded.userId]);

    if (result.rows.length > 0) {
      req.user = result.rows[0];
      req.userId = result.rows[0].id;
    } else {
      req.user = null;
      req.userId = null;
    }
    next();
  } catch (error) {
    req.user = null;
    req.userId = null;
    next();
  }
};

module.exports = { authenticate, optionalAuth };
