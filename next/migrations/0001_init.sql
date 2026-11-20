-- Finance Manager v2: NEW and EMPTY Cloudflare D1 database.
-- Never apply to the legacy Google Sheets backend.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  kind TEXT NOT NULL CHECK (kind IN ('cash','bank','credit_card')),
  opening_balance_vnd INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT,
  UNIQUE(owner_id, name)
);
CREATE INDEX IF NOT EXISTS ix_accounts_owner ON accounts(owner_id, archived_at);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  kind TEXT NOT NULL CHECK (kind IN ('income','expense','both')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT,
  UNIQUE(owner_id, kind, name)
);

CREATE TABLE IF NOT EXISTS counterparties (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(owner_id, name)
);

CREATE TABLE IF NOT EXISTS debts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  counterparty_id TEXT NOT NULL REFERENCES counterparties(id),
  direction TEXT NOT NULL CHECK (direction IN ('receivable','payable')),
  principal_vnd INTEGER NOT NULL CHECK (principal_vnd > 0),
  settled_vnd INTEGER NOT NULL DEFAULT 0 CHECK (settled_vnd >= 0 AND settled_vnd <= principal_vnd),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  due_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_debts_owner ON debts(owner_id, direction, due_date);

-- Canonical signs: amount_vnd always positive; kind determines direction.
-- 'transfer' moves money between two user accounts, no income/expense.
-- 'card_charge' increases credit-card liability. 'card_payment' settles it.
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'income','expense','transfer','card_charge','card_payment','debt_collection','debt_payment'
  )),
  amount_vnd INTEGER NOT NULL CHECK (amount_vnd > 0 AND amount_vnd <= 9000000000000),
  account_id TEXT REFERENCES accounts(id),
  other_account_id TEXT REFERENCES accounts(id),
  category_id TEXT REFERENCES categories(id),
  counterparty_id TEXT REFERENCES counterparties(id),
  debt_id TEXT REFERENCES debts(id),
  merchant TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','bank_notification','import')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  UNIQUE(owner_id, request_id),
  CHECK (kind != 'transfer' OR (other_account_id IS NOT NULL AND other_account_id != account_id))
);
CREATE INDEX IF NOT EXISTS ix_tx_owner_date ON transactions(owner_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_tx_owner_account ON transactions(owner_id, account_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_tx_owner_debt ON transactions(owner_id, debt_id);

-- Notification content is NOT stored by default. Only a redacted summary,
-- fingerprint, amounts and the source's package identifier are retained.
CREATE TABLE IF NOT EXISTS bank_inbox (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  source_package TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  amount_vnd INTEGER NOT NULL CHECK (amount_vnd > 0),
  flow TEXT NOT NULL CHECK (flow IN ('credit','debit')),
  redacted_summary TEXT NOT NULL,
  occurred_at TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','posted','ignored')),
  posted_transaction_id TEXT REFERENCES transactions(id),
  UNIQUE(owner_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS ix_bank_inbox_owner ON bank_inbox(owner_id, status, received_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  entity_kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_audit_owner ON audit_log(owner_id, occurred_at DESC);
