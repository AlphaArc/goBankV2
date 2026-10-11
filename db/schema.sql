-- =============================================================================
-- goBankV2 - Educational DBMS Transaction Hazard Simulator
-- Database Schema Definition (InnoDB Engine Required for ACID & Row-level Locks)
-- =============================================================================

CREATE DATABASE IF NOT EXISTS gobank_sim
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE gobank_sim;

-- Drop existing tables to allow clean state resets
DROP TABLE IF EXISTS simulation_logs;
DROP TABLE IF EXISTS accounts;

-- Core Accounts Table
CREATE TABLE accounts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    account_code VARCHAR(10) NOT NULL UNIQUE, -- e.g., 'A', 'B', 'C'
    owner_name VARCHAR(100) NOT NULL,
    balance DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Simulation Run Log Table
CREATE TABLE simulation_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    run_id VARCHAR(64) NOT NULL,
    step_number INT NOT NULL,
    transaction_id VARCHAR(10) NOT NULL, -- e.g., 'T1', 'T2', 'T3', 'T4'
    operation VARCHAR(10) NOT NULL,      -- 'READ', 'WRITE', 'COMMIT', 'ROLLBACK'
    account_code VARCHAR(10) NOT NULL,
    value_observed DECIMAL(12, 2) NULL,
    value_written DECIMAL(12, 2) NULL,
    status VARCHAR(20) NOT NULL,         -- 'SUCCESS', 'BLOCKED', 'TIMEOUT', 'ABORTED'
    details TEXT NULL,
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Seed Accounts with Initial Balances for Demonstrations
INSERT INTO accounts (account_code, owner_name, balance) VALUES
('A', 'Alice Springs', 1000.00),
('B', 'Bob Vance',     1000.00),
('C', 'Charlie Day',   1000.00);
