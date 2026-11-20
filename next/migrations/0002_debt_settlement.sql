-- Atomic debt settlement handling for new positive-amount ledger rows.
-- A debt can be settled only by its owner, in the correct direction, and not beyond principal.
CREATE TRIGGER IF NOT EXISTS tr_debt_settlement_insert
BEFORE INSERT ON transactions
WHEN NEW.kind IN ('debt_collection','debt_payment')
BEGIN
  SELECT CASE WHEN NEW.debt_id IS NULL THEN
    RAISE(ABORT,'settlement requires debt_id') END;
  UPDATE debts SET settled_vnd=settled_vnd+NEW.amount_vnd
  WHERE id=NEW.debt_id AND owner_id=NEW.owner_id
    AND direction=(CASE NEW.kind WHEN 'debt_collection' THEN 'receivable' ELSE 'payable' END)
    AND archived_at IS NULL AND settled_vnd+NEW.amount_vnd<=principal_vnd;
  SELECT CASE WHEN changes()<>1 THEN
    RAISE(ABORT,'settlement exceeds debt or references wrong owner/direction') END;
END;

-- Reversing a posted settlement reverses its accounting in the same DB mutation.
CREATE TRIGGER IF NOT EXISTS tr_debt_settlement_soft_delete
AFTER UPDATE OF deleted_at ON transactions
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
 AND OLD.kind IN ('debt_collection','debt_payment')
BEGIN
  UPDATE debts SET settled_vnd=settled_vnd-OLD.amount_vnd
  WHERE id=OLD.debt_id AND owner_id=OLD.owner_id
    AND settled_vnd>=OLD.amount_vnd;
  SELECT CASE WHEN changes()<>1 THEN
    RAISE(ABORT,'debt reversal invariant violated') END;
END;
