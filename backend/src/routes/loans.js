const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');

// GET /api/loans - List user's loans
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await query(
      `SELECT l.*, lt.name as loan_type, lt.code as loan_type_code, lt.base_interest_rate
       FROM loans l
       JOIN loan_types lt ON l.loan_type_id = lt.id
       WHERE l.user_id = $1
       ORDER BY l.created_at DESC`,
      [req.userId]
    );

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows.map(l => ({
        ...l,
        loan_amount: parseFloat(l.loan_amount),
        approved_amount: l.approved_amount ? parseFloat(l.approved_amount) : null,
        emi_amount: l.emi_amount ? parseFloat(l.emi_amount) : null,
        processing_fee: l.processing_fee ? parseFloat(l.processing_fee) : null,
        interest_rate: parseFloat(l.interest_rate),
      })),
    });
  } catch (error) {
    console.error('[Loans] List error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch loans' });
  }
});

// GET /api/loans/types - Get available loan types
router.get('/types', authenticate, async (req, res) => {
  try {
    const result = await query('SELECT * FROM loan_types ORDER BY id');
    res.json({
      success: true,
      data: result.rows.map(l => ({
        ...l,
        min_amount: parseFloat(l.min_amount),
        max_amount: l.max_amount ? parseFloat(l.max_amount) : null,
        base_interest_rate: parseFloat(l.base_interest_rate),
        processing_fee_percent: parseFloat(l.processing_fee_percent),
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch loan types' });
  }
});

// POST /api/loans/check-eligibility - Check loan eligibility
router.post('/check-eligibility', authenticate, async (req, res) => {
  try {
    const { loanTypeCode, loanAmount, monthlyIncome, existingEmi, employmentType } = req.body;

    const loanTypeResult = await query('SELECT * FROM loan_types WHERE code = $1', [loanTypeCode]);
    if (loanTypeResult.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid loan type' });
    }

    const loanType = loanTypeResult.rows[0];
    const amount = parseFloat(loanAmount);

    if (amount < parseFloat(loanType.min_amount)) {
      return res.json({
        success: true,
        eligible: false,
        message: `Minimum loan amount for ${loanType.name} is INR ${parseFloat(loanType.min_amount).toLocaleString('en-IN')}`,
      });
    }

    if (loanType.max_amount && amount > parseFloat(loanType.max_amount)) {
      return res.json({
        success: true,
        eligible: false,
        message: `Maximum loan amount for ${loanType.name} is INR ${parseFloat(loanType.max_amount).toLocaleString('en-IN')}`,
      });
    }

    const income = parseFloat(monthlyIncome || 0);
    const currentEmi = parseFloat(existingEmi || 0);

    if (income > 0) {
      // Simple eligibility: monthly EMI should not exceed 50% of monthly income
      const maxEmiAffordable = income * 0.5 - currentEmi;

      // Calculate approximate EMI for 5 years at the given rate
      const rate = parseFloat(loanType.base_interest_rate) / 12 / 100;
      const tenure = 60; // 5 years default
      const estimatedEmi = amount * rate * Math.pow(1 + rate, tenure) / (Math.pow(1 + rate, tenure) - 1);

      if (estimatedEmi > maxEmiAffordable) {
        return res.json({
          success: true,
          eligible: false,
          message: `Loan amount may be too high based on your income. Estimated EMI (INR ${Math.round(estimatedEmi).toLocaleString('en-IN')}) exceeds affordable limit.`,
          details: {
            estimatedEmi: Math.round(estimatedEmi),
            maxAffordable: Math.round(maxEmiAffordable),
            suggestedAmount: Math.round(maxEmiAffordable * (Math.pow(1 + rate, tenure) - 1) / (rate * Math.pow(1 + rate, tenure))),
          },
        });
      }
    }

    res.json({
      success: true,
      eligible: true,
      message: `You are eligible for a ${loanType.name} of up to INR ${amount.toLocaleString('en-IN')}!`,
      details: {
        maxAmount: loanType.max_amount ? parseFloat(loanType.max_amount) : null,
        interestRate: parseFloat(loanType.base_interest_rate),
        processingFeePercent: parseFloat(loanType.processing_fee_percent),
      },
    });
  } catch (error) {
    console.error('[Loans] Eligibility error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to check eligibility' });
  }
});

// POST /api/loans/calculate-emi - Calculate EMI
router.post('/calculate-emi', authenticate, async (req, res) => {
  try {
    const { loanAmount, interestRate, tenureMonths } = req.body;
    const P = parseFloat(loanAmount);
    const r = parseFloat(interestRate) / 12 / 100;
    const n = parseInt(tenureMonths);

    if (!P || !r || !n || P <= 0 || r <= 0 || n <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid parameters' });
    }

    const emi = P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
    const totalPayment = emi * n;
    const totalInterest = totalPayment - P;

    res.json({
      success: true,
      data: {
        loanAmount: P,
        monthlyEmi: Math.round(emi),
        totalInterest: Math.round(totalInterest),
        totalPayment: Math.round(totalPayment),
        tenureMonths: n,
        interestRate: parseFloat(interestRate),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'EMI calculation failed' });
  }
});

// POST /api/loans/apply - Apply for a loan
router.post('/apply', authenticate, async (req, res) => {
  try {
    const { loanTypeCode, loanAmount, tenureMonths, purpose, employmentType, monthlyIncome, existingEmi } = req.body;

    if (!loanTypeCode || !loanAmount || !tenureMonths) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const loanTypeResult = await query('SELECT * FROM loan_types WHERE code = $1', [loanTypeCode]);
    if (loanTypeResult.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid loan type' });
    }

    const loanType = loanTypeResult.rows[0];
    const amount = parseFloat(loanAmount);

    // Generate loan reference
    const refPrefix = loanType.code + '-' + Date.now().toString(36).toUpperCase();

    // Calculate EMI
    const rate = parseFloat(loanType.base_interest_rate) / 12 / 100;
    const tenure = parseInt(tenureMonths);
    const emi = amount * rate * Math.pow(1 + rate, tenure) / (Math.pow(1 + rate, tenure) - 1);
    const processingFee = amount * parseFloat(loanType.processing_fee_percent) / 100;

    const result = await query(
      `INSERT INTO loans (user_id, loan_type_id, loan_reference, loan_amount, interest_rate,
        tenure_months, emi_amount, processing_fee, purpose, employment_type, monthly_income, existing_emi)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [req.userId, loanType.id, refPrefix, amount, parseFloat(loanType.base_interest_rate),
       tenure, Math.round(emi), Math.round(processingFee), purpose || '', employmentType || '',
       monthlyIncome ? parseFloat(monthlyIncome) : null, existingEmi ? parseFloat(existingEmi) : null]
    );

    // Notification
    await query(
      `INSERT INTO notifications (user_id, title, message, type, category, reference_id, reference_type)
       VALUES ($1, 'Loan Application Submitted', $2, 'info', 'loan', $3, 'loan')`,
      [req.userId,
       `Your ${loanType.name} application (${refPrefix}) has been submitted. We'll process it shortly!`,
       refPrefix]
    );

    res.status(201).json({
      success: true,
      message: `Your ${loanType.name} application has been submitted successfully!`,
      data: {
        ...result.rows[0],
        loan_amount: parseFloat(result.rows[0].loan_amount),
        interest_rate: parseFloat(result.rows[0].interest_rate),
        emi_amount: result.rows[0].emi_amount ? parseFloat(result.rows[0].emi_amount) : null,
        processing_fee: result.rows[0].processing_fee ? parseFloat(result.rows[0].processing_fee) : null,
      },
    });
  } catch (error) {
    console.error('[Loans] Apply error:', error.message);
    res.status(500).json({ success: false, message: 'Loan application failed' });
  }
});

// GET /api/loans/:id - Get loan details
router.get('/:id', authenticate, async (req, res) => {
  try {
    const loanResult = await query(
      `SELECT l.*, lt.name as loan_type, lt.code as loan_type_code, lt.base_interest_rate
       FROM loans l
       JOIN loan_types lt ON l.loan_type_id = lt.id
       WHERE l.id = $1 AND l.user_id = $2`,
      [req.params.id, req.userId]
    );

    if (loanResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Loan not found' });
    }

    // Get repayment schedule
    const repaymentsResult = await query(
      `SELECT * FROM loan_repayments WHERE loan_id = $1 ORDER BY emi_number`,
      [req.params.id]
    );

    res.json({
      success: true,
      data: {
        loan: {
          ...loanResult.rows[0],
          loan_amount: parseFloat(loanResult.rows[0].loan_amount),
          interest_rate: parseFloat(loanResult.rows[0].interest_rate),
          emi_amount: loanResult.rows[0].emi_amount ? parseFloat(loanResult.rows[0].emi_amount) : null,
        },
        repayments: repaymentsResult.rows,
      },
    });
  } catch (error) {
    console.error('[Loans] Detail error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch loan details' });
  }
});

module.exports = router;
