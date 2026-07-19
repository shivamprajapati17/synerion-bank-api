const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { testConnection } = require('./config/database');

// Import routes
const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/accounts');
const transactionRoutes = require('./routes/transactions');
const loanRoutes = require('./routes/loans');
const investmentRoutes = require('./routes/investments');
const profileRoutes = require('./routes/profile');

const app = express();
const PORT = process.env.PORT || 5000;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: true,  // Allow all origins (safe for demo; restrict in production)
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
  },
});
app.use('/api/', limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging
app.use(morgan('dev'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Synerion Bank API is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/investments', investmentRoutes);
app.use('/api/profile', profileRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[Server] Error:', err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// Start server
const startServer = async () => {
  const dbConnected = await testConnection();

  app.listen(PORT, () => {
    console.log('============================================');
    console.log('  Synerion Bank API Server');
    console.log('  "Where Intelligence meets Trust"');
    console.log('============================================');
    console.log(`  Port:        ${PORT}`);
    console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`  Database:    ${dbConnected ? 'Connected' : 'Not Connected'}`);
    console.log(`  CORS Origin: ${process.env.CORS_ORIGIN || 'All Origins (origin: true)'}`);
    console.log('============================================');
  });
};

startServer();

module.exports = app;
