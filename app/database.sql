-- Database Schema for Rossoa Construction Tracker

-- Users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Workers table
CREATE TABLE workers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    state VARCHAR(20) NOT NULL DEFAULT 'Zamestnan',
    archived_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Constructions table
CREATE TABLE constructions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    customer VARCHAR(255),
    state VARCHAR(20) NOT NULL DEFAULT 'Planned',
    beginning_date DATE,
    price DECIMAL(12, 2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Materials and Services table
CREATE TABLE materials_services (
    id SERIAL PRIMARY KEY,
    construction_id INTEGER REFERENCES constructions(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    category VARCHAR(50) NOT NULL,
    type VARCHAR(100) NOT NULL,
    price DECIMAL(10, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Works table
CREATE TABLE works (
    id SERIAL PRIMARY KEY,
    construction_id INTEGER REFERENCES constructions(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    type VARCHAR(100) NOT NULL,
    worker_id INTEGER REFERENCES workers(id) ON DELETE SET NULL,
    price DECIMAL(10, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for better performance
CREATE INDEX idx_materials_construction ON materials_services(construction_id);
CREATE INDEX idx_works_construction ON works(construction_id);
CREATE INDEX idx_works_worker ON works(worker_id);
CREATE INDEX idx_workers_state ON workers(state);

-- Passkey credentials table
CREATE TABLE IF NOT EXISTS passkey_credentials (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    credential_id TEXT UNIQUE NOT NULL,
    public_key TEXT NOT NULL,
    counter BIGINT DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Insert default admin user (password: admin123)
-- Password will be hashed when the app starts if not exists
INSERT INTO users (username, password) VALUES ('admin', '$2b$10$XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX')
ON CONFLICT (username) DO NOTHING;