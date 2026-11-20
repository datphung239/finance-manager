-- Dedupe debt creation retries; unique only inside the verified owner.
ALTER TABLE debts ADD COLUMN request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_debts_owner_request
 ON debts(owner_id,request_id) WHERE request_id IS NOT NULL;
