-- ============================================
-- Synerion Bank - Database Schema
-- "Where Intelligence meets Trust"
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- USERS & AUTHENTICATION
-- ============================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    date_of_birth DATE,
    gender VARCHAR(20),
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    pincode VARCHAR(10),
    aadhaar_number VARCHAR(12) UNIQUE,
    pan_number VARCHAR(10) UNIQUE,
    occupation VARCHAR(100),
    annual_income DECIMAL(15, 2),
    is_kyc_completed BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    profile_image_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(500) NOT NULL,
    device_info TEXT,
    ip_address VARCHAR(50),
    is_active BOOLEAN DEFAULT TRUE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- ACCOUNTS
-- ============================================

CREATE TABLE IF NOT EXISTS account_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL,
    description TEXT,
    min_balance DECIMAL(15, 2) DEFAULT 0,
    interest_rate DECIMAL(5, 2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO account_types (name, code, description, min_balance, interest_rate) VALUES
    ('Savings Account', 'SAV', 'Personal savings account with interest benefits', 1000.00, 4.00),
    ('Current Account', 'CUR', 'Business current account for daily transactions', 5000.00, 0.00),
    ('Salary Account', 'SAL', 'Corporate salary account with zero balance', 0.00, 3.50),
    ('Student Account', 'STU', 'Student savings account with special benefits', 0.00, 3.00),
    ('Senior Citizen Account', 'SEN', 'Senior savings account with higher interest', 1000.00, 5.50),
    ('NRI Account', 'NRI', 'NRI savings account with international features', 10000.00, 4.50),
    ('Joint Account', 'JNT', 'Joint savings account for multiple holders', 2000.00, 4.00),
    ('Business Account', 'BUS', 'Business account for SMEs and enterprises', 10000.00, 0.00)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_type_id INTEGER NOT NULL REFERENCES account_types(id),
    account_number VARCHAR(20) UNIQUE NOT NULL,
    ifsc_code VARCHAR(20) DEFAULT 'SYNB0001234',
    balance DECIMAL(15, 2) DEFAULT 0.00,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'frozen', 'closed')),
    is_joint BOOLEAN DEFAULT FALSE,
    joint_holder_name VARCHAR(255),
    opened_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    closed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Account number sequence
CREATE SEQUENCE IF NOT EXISTS account_number_seq START WITH 1000000001;

-- ============================================
-- BENEFICIARIES
-- ============================================

CREATE TABLE IF NOT EXISTS beneficiaries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    beneficiary_name VARCHAR(255) NOT NULL,
    account_number VARCHAR(20) NOT NULL,
    ifsc_code VARCHAR(20) NOT NULL,
    bank_name VARCHAR(255),
    transfer_limit DECIMAL(15, 2) DEFAULT 500000.00,
    is_verified BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- TRANSACTIONS
-- ============================================

CREATE TABLE IF NOT EXISTS transaction_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL,
    description TEXT
);

INSERT INTO transaction_types (name, code, description) VALUES
    ('NEFT', 'NEFT', 'National Electronic Funds Transfer'),
    ('RTGS', 'RTGS', 'Real Time Gross Settlement'),
    ('IMPS', 'IMPS', 'Immediate Payment Service'),
    ('UPI Transfer', 'UPI', 'UPI based transfer'),
    ('Internal Transfer', 'INT', 'Transfer within Synerion Bank'),
    ('Cheque Deposit', 'CHQ', 'Cheque deposit transaction'),
    ('Cash Deposit', 'CDP', 'Cash deposit at branch/ATM'),
    ('Cash Withdrawal', 'CWD', 'Cash withdrawal at branch/ATM'),
    ('Bill Payment', 'BIL', 'Utility bill payment'),
    ('Loan Disbursement', 'LND', 'Loan amount disbursement'),
    ('Loan Repayment', 'LNR', 'Loan EMI repayment'),
    ('Investment Purchase', 'INV', 'Investment product purchase'),
    ('Investment Redemption', 'INR', 'Investment product redemption'),
    ('Interest Credit', 'INT', 'Interest credited'),
    ('Fee Charged', 'FEE', 'Service fee charged')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_reference VARCHAR(30) UNIQUE NOT NULL,
    from_account_id UUID REFERENCES accounts(id),
    to_account_id UUID REFERENCES accounts(id),
    transaction_type_id INTEGER NOT NULL REFERENCES transaction_types(id),
    amount DECIMAL(15, 2) NOT NULL,
    fee DECIMAL(15, 2) DEFAULT 0.00,
    balance_before DECIMAL(15, 2),
    balance_after DECIMAL(15, 2),
    description TEXT,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'reversed')),
    is_international BOOLEAN DEFAULT FALSE,
    currency VARCHAR(3) DEFAULT 'INR',
    remarks TEXT,
    initiated_by UUID REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Transaction reference sequence
CREATE SEQUENCE IF NOT EXISTS txn_ref_seq START WITH 1000000;

-- ============================================
-- LOANS
-- ============================================

CREATE TABLE IF NOT EXISTS loan_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL,
    description TEXT,
    min_amount DECIMAL(15, 2) DEFAULT 0,
    max_amount DECIMAL(15, 2),
    min_tenure_months INTEGER DEFAULT 1,
    max_tenure_months INTEGER DEFAULT 360,
    base_interest_rate DECIMAL(5, 2) NOT NULL,
    processing_fee_percent DECIMAL(5, 2) DEFAULT 1.00
);

INSERT INTO loan_types (name, code, description, min_amount, max_amount, min_tenure_months, max_tenure_months, base_interest_rate, processing_fee_percent) VALUES
    ('Home Loan', 'HOME', 'Purchase or renovate your dream home', 500000.00, 50000000.00, 12, 360, 8.50, 1.00),
    ('Personal Loan', 'PERS', 'Quick personal loans for any need', 10000.00, 2500000.00, 6, 60, 11.00, 2.00),
    ('Education Loan', 'EDU', 'Fund your education and build your future', 50000.00, 5000000.00, 12, 180, 9.00, 0.50),
    ('Vehicle Loan', 'VEH', 'Drive your dream car with easy EMIs', 100000.00, 5000000.00, 12, 84, 8.75, 1.50),
    ('Business Loan', 'BIZ', 'Grow your business with flexible funding', 100000.00, 50000000.00, 6, 120, 10.50, 1.50),
    ('Gold Loan', 'GOLD', 'Instant loans against gold jewellery', 5000.00, 5000000.00, 1, 36, 7.50, 0.50),
    ('MSME Loan', 'MSME', 'Special loans for Micro, Small & Medium Enterprises', 100000.00, 20000000.00, 6, 120, 9.50, 1.00),
    ('Loan Against Property', 'LAP', 'Unlock value from your property', 500000.00, 100000000.00, 12, 240, 9.00, 1.00)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS loans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID REFERENCES accounts(id),
    loan_type_id INTEGER NOT NULL REFERENCES loan_types(id),
    loan_reference VARCHAR(20) UNIQUE NOT NULL,
    loan_amount DECIMAL(15, 2) NOT NULL,
    approved_amount DECIMAL(15, 2),
    interest_rate DECIMAL(5, 2) NOT NULL,
    tenure_months INTEGER NOT NULL,
    emi_amount DECIMAL(15, 2),
    processing_fee DECIMAL(15, 2),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'disbursed', 'active', 'closed', 'rejected', 'defaulted')),
    purpose TEXT,
    employment_type VARCHAR(50),
    monthly_income DECIMAL(15, 2),
    existing_emi DECIMAL(15, 2) DEFAULT 0,
    documents JSONB,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    approved_at TIMESTAMP WITH TIME ZONE,
    disbursed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loan_repayments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    loan_id UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
    transaction_id UUID REFERENCES transactions(id),
    emi_number INTEGER NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    principal_paid DECIMAL(15, 2) DEFAULT 0,
    interest_paid DECIMAL(15, 2) DEFAULT 0,
    due_date DATE NOT NULL,
    paid_date DATE,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue', 'partial')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- INVESTMENTS
-- ============================================

CREATE TABLE IF NOT EXISTS investment_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL,
    description TEXT,
    min_investment DECIMAL(15, 2) DEFAULT 0,
    risk_level VARCHAR(20) CHECK (risk_level IN ('low', 'moderate', 'high')),
    expected_returns VARCHAR(50)
);

INSERT INTO investment_types (name, code, description, min_investment, risk_level, expected_returns) VALUES
    ('Fixed Deposit', 'FD', 'Secure fixed returns on your deposit', 1000.00, 'low', '5.00% - 7.50%'),
    ('Recurring Deposit', 'RD', 'Build savings with monthly deposits', 500.00, 'low', '5.00% - 6.50%'),
    ('Mutual Funds - Equity', 'MFE', 'High growth equity mutual funds', 500.00, 'high', '10% - 18%'),
    ('Mutual Funds - Debt', 'MFD', 'Stable debt mutual funds', 500.00, 'moderate', '6% - 9%'),
    ('SIP (Systematic Investment Plan)', 'SIP', 'Regular investment in mutual funds', 500.00, 'moderate', '10% - 15%'),
    ('Government Bonds', 'GBD', 'Safe government backed bonds', 10000.00, 'low', '6.00% - 8.00%'),
    ('Corporate Bonds', 'CBD', 'Higher return corporate bonds', 10000.00, 'moderate', '8% - 12%'),
    ('Tax Saving FD', 'TFD', 'Tax saver fixed deposit (5yr lock-in)', 1000.00, 'low', '5.50% - 7.00%')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS investments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    investment_type_id INTEGER NOT NULL REFERENCES investment_types(id),
    account_id UUID REFERENCES accounts(id),
    investment_reference VARCHAR(20) UNIQUE NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    current_value DECIMAL(15, 2),
    interest_rate DECIMAL(5, 2),
    tenure_months INTEGER,
    start_date DATE DEFAULT CURRENT_DATE,
    maturity_date DATE,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'matured', 'redeemed', 'closed')),
    risk_profile VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- LOCKERS
-- ============================================

CREATE TABLE IF NOT EXISTS locker_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL,
    size_sqft DECIMAL(5, 2),
    monthly_rent DECIMAL(10, 2) NOT NULL,
    description TEXT
);

INSERT INTO locker_types (name, code, size_sqft, monthly_rent, description) VALUES
    ('Small Locker', 'SM', 1.5, 500.00, 'Perfect for documents and jewellery'),
    ('Medium Locker', 'MD', 3.0, 1000.00, 'Ideal for business documents and valuables'),
    ('Large Locker', 'LG', 5.0, 2000.00, 'Suitable for large quantities of valuables'),
    ('Business Locker', 'BIZ', 10.0, 5000.00, 'For business inventory and records')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS lockers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    locker_type_id INTEGER NOT NULL REFERENCES locker_types(id),
    locker_number VARCHAR(20) UNIQUE NOT NULL,
    branch_location VARCHAR(255) DEFAULT 'Main Branch',
    status VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available', 'booked', 'active', 'maintenance', 'closed')),
    booking_date TIMESTAMP WITH TIME ZONE,
    expiry_date DATE,
    is_joint BOOLEAN DEFAULT FALSE,
    joint_holder_name VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- BILL PAYMENTS
-- ============================================

CREATE TABLE IF NOT EXISTS bill_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL,
    icon_url TEXT
);

INSERT INTO bill_categories (name, code) VALUES
    ('Electricity', 'ELEC'),
    ('Water', 'WATER'),
    ('Gas', 'GAS'),
    ('Internet', 'NET'),
    ('DTH / Cable TV', 'DTH'),
    ('Mobile Recharge', 'MOB'),
    ('Insurance Premium', 'INS'),
    ('Credit Card Bill', 'CCARD'),
    ('Municipal Taxes', 'MUNI'),
    ('Education Fees', 'EDU')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS bill_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id),
    bill_category_id INTEGER NOT NULL REFERENCES bill_categories(id),
    biller_name VARCHAR(255) NOT NULL,
    biller_account_number VARCHAR(100),
    amount DECIMAL(15, 2) NOT NULL,
    transaction_id UUID REFERENCES transactions(id),
    payment_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- SUPPORT & COMPLAINTS
-- ============================================

CREATE TABLE IF NOT EXISTS complaint_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL
);

INSERT INTO complaint_categories (name, code) VALUES
    ('Transaction Issue', 'TXN'),
    ('Account Problem', 'ACC'),
    ('Card Issue', 'CARD'),
    ('Loan Related', 'LOAN'),
    ('Service Feedback', 'SRV'),
    ('Technical Issue', 'TECH'),
    ('Fraud Report', 'FRAUD'),
    ('Other', 'OTHER')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS complaints (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES complaint_categories(id),
    complaint_reference VARCHAR(20) UNIQUE NOT NULL,
    subject VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed', 'escalated')),
    assigned_to VARCHAR(100),
    resolution_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- NOTIFICATIONS
-- ============================================

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(50) DEFAULT 'info' CHECK (type IN ('info', 'success', 'warning', 'error', 'promotion')),
    category VARCHAR(50) DEFAULT 'general' CHECK (category IN ('general', 'transaction', 'account', 'loan', 'investment', 'security', 'promotion')),
    is_read BOOLEAN DEFAULT FALSE,
    reference_id VARCHAR(50),
    reference_type VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- AUDIT LOGS
-- ============================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id VARCHAR(50),
    old_values JSONB,
    new_values JSONB,
    ip_address VARCHAR(50),
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_aadhaar ON users(aadhaar_number);
CREATE INDEX idx_accounts_user_id ON accounts(user_id);
CREATE INDEX idx_accounts_account_number ON accounts(account_number);
CREATE INDEX idx_transactions_from_account ON transactions(from_account_id);
CREATE INDEX idx_transactions_to_account ON transactions(to_account_id);
CREATE INDEX idx_transactions_reference ON transactions(transaction_reference);
CREATE INDEX idx_transactions_created ON transactions(created_at);
CREATE INDEX idx_loans_user_id ON loans(user_id);
CREATE INDEX idx_loans_status ON loans(status);
CREATE INDEX idx_loan_repayments_loan_id ON loan_repayments(loan_id);
CREATE INDEX idx_investments_user_id ON investments(user_id);
CREATE INDEX idx_complaints_user_id ON complaints(user_id);
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_is_read ON notifications(user_id, is_read);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply update_updated_at trigger to all relevant tables
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_accounts_updated_at
    BEFORE UPDATE ON accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_loans_updated_at
    BEFORE UPDATE ON loans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_investments_updated_at
    BEFORE UPDATE ON investments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to auto-generate account number
CREATE OR REPLACE FUNCTION generate_account_number()
RETURNS TEXT AS $$
DECLARE
    next_val BIGINT;
BEGIN
    next_val := nextval('account_number_seq');
    RETURN 'SYNB' || LPAD(next_val::TEXT, 10, '0');
END;
$$ LANGUAGE plpgsql;

-- Function to auto-generate transaction reference
CREATE OR REPLACE FUNCTION generate_txn_reference()
RETURNS TEXT AS $$
DECLARE
    next_val BIGINT;
BEGIN
    next_val := nextval('txn_ref_seq');
    RETURN 'SYNTXN' || TO_CHAR(NOW(), 'YYMMDD') || LPAD(next_val::TEXT, 7, '0');
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- SEED DATA (Sample customer for demo)
-- ============================================

-- Insert sample user (password: Synerion@123 - bcrypt hash)
INSERT INTO users (full_name, email, phone, password_hash, date_of_birth, gender, address, city, state, pincode, is_kyc_completed, is_active)
VALUES (
    'Rahul Sharma',
    'rahul.sharma@email.com',
    '+919876543210',
    '$2a$10$5aEGmdD1wbJlW38kD2xvN.2Q4tVNanUIlpy45kMtXzXaiyhTDxNrm',
    '1990-05-15',
    'Male',
    '42, MG Road, Indiranagar',
    'Bangalore',
    'Karnataka',
    '560038',
    TRUE,
    TRUE
);

-- Insert sample account for user
INSERT INTO accounts (user_id, account_type_id, account_number, ifsc_code, balance, status)
VALUES (
    (SELECT id FROM users WHERE email = 'rahul.sharma@email.com'),
    (SELECT id FROM account_types WHERE code = 'SAV'),
    generate_account_number(),
    'SYNB0001234',
    1250000.50,
    'active'
);

-- Insert some sample transactions
INSERT INTO transactions (transaction_reference, from_account_id, amount, transaction_type_id, balance_before, balance_after, status, description, created_at)
SELECT
    'SYNTXN' || TO_CHAR(NOW() - (n || ' days')::INTERVAL, 'YYMMDD') || LPAD(n::TEXT, 7, '0'),
    (SELECT id FROM accounts WHERE user_id = (SELECT id FROM users WHERE email = 'rahul.sharma@email.com') LIMIT 1),
    CASE n % 5
        WHEN 0 THEN 50000.00
        WHEN 1 THEN 2500.00
        WHEN 2 THEN 15000.00
        WHEN 3 THEN 750.00
        ELSE 200000.00
    END,
    (SELECT id FROM transaction_types WHERE code = CASE n % 4
        WHEN 0 THEN 'NEFT'
        WHEN 1 THEN 'UPI'
        WHEN 2 THEN 'IMPS'
        ELSE 'INT'
    END),
    1000000.00 + (n * 10000),
    1000000.00 + ((n+1) * 10000),
    'completed',
    CASE n % 5
        WHEN 0 THEN 'Salary credit'
        WHEN 1 THEN 'Grocery store payment'
        WHEN 2 THEN 'Online shopping'
        WHEN 3 THEN 'Restaurant bill'
        ELSE 'Freelance payment'
    END,
    NOW() - (n || ' days')::INTERVAL
FROM generate_series(1, 10) n;
