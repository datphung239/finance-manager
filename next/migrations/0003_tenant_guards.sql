-- Defense-in-depth for a NEW, empty Finance Manager V2 D1 database.
-- Worker MUST also verify the Cloudflare Access JWT before every query.
CREATE TRIGGER IF NOT EXISTS tr_debt_owner_guard BEFORE INSERT ON debts BEGIN
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM counterparties WHERE id=NEW.counterparty_id AND owner_id=NEW.owner_id)
  THEN RAISE(ABORT,'debt counterparty owner mismatch') END;
END;
CREATE TRIGGER IF NOT EXISTS tr_tx_owner_guard BEFORE INSERT ON transactions BEGIN
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM accounts WHERE id=NEW.account_id AND owner_id=NEW.owner_id AND archived_at IS NULL)
  THEN RAISE(ABORT,'account owner mismatch') END;
 SELECT CASE WHEN NEW.other_account_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts WHERE id=NEW.other_account_id AND owner_id=NEW.owner_id AND archived_at IS NULL)
  THEN RAISE(ABORT,'destination account owner mismatch') END;
 SELECT CASE WHEN NEW.category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM categories WHERE id=NEW.category_id AND owner_id=NEW.owner_id AND archived_at IS NULL)
  THEN RAISE(ABORT,'category owner mismatch') END;
 SELECT CASE WHEN NEW.counterparty_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM counterparties WHERE id=NEW.counterparty_id AND owner_id=NEW.owner_id)
  THEN RAISE(ABORT,'counterparty owner mismatch') END;
 SELECT CASE WHEN NEW.debt_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM debts WHERE id=NEW.debt_id AND owner_id=NEW.owner_id AND archived_at IS NULL)
  THEN RAISE(ABORT,'debt owner mismatch') END;
 SELECT CASE WHEN NEW.kind IN ('income','expense','transfer','card_payment','debt_collection','debt_payment')
   AND NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.account_id AND kind IN ('cash','bank'))
  THEN RAISE(ABORT,'cash flow requires cash/bank account') END;
 SELECT CASE WHEN NEW.kind='card_charge' AND NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.account_id AND kind='credit_card')
  THEN RAISE(ABORT,'card charge requires card account') END;
 SELECT CASE WHEN NEW.kind IN ('income','expense','card_charge','debt_collection','debt_payment') AND NEW.other_account_id IS NOT NULL
  THEN RAISE(ABORT,'unexpected second account') END;
 SELECT CASE WHEN NEW.kind='transfer' AND (NEW.other_account_id IS NULL OR NEW.other_account_id=NEW.account_id OR
   NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.other_account_id AND kind IN ('cash','bank')))
  THEN RAISE(ABORT,'invalid transfer destination') END;
 SELECT CASE WHEN NEW.kind='card_payment' AND (NEW.other_account_id IS NULL OR
   NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.other_account_id AND kind='credit_card'))
  THEN RAISE(ABORT,'invalid card payment destination') END;
 SELECT CASE WHEN NEW.category_id IS NOT NULL AND NEW.kind IN ('income','expense','card_charge') AND NOT EXISTS(
   SELECT 1 FROM categories WHERE id=NEW.category_id AND kind IN (CASE WHEN NEW.kind='income' THEN 'income' ELSE 'expense' END,'both'))
  THEN RAISE(ABORT,'income/expense category mismatch') END;
 SELECT CASE WHEN NEW.category_id IS NOT NULL AND NEW.kind IN ('transfer','card_payment','debt_collection','debt_payment')
  THEN RAISE(ABORT,'category not allowed on settlement/transfer') END;
END;
CREATE TRIGGER IF NOT EXISTS tr_bank_post_owner BEFORE UPDATE OF posted_transaction_id ON bank_inbox
 WHEN NEW.posted_transaction_id IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM transactions WHERE id=NEW.posted_transaction_id AND owner_id=NEW.owner_id AND source='bank_notification' AND deleted_at IS NULL)
  THEN RAISE(ABORT,'bank posting owner mismatch') END;
END;
CREATE TRIGGER IF NOT EXISTS tr_bank_reopen AFTER UPDATE OF deleted_at ON transactions
 WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND OLD.source='bank_notification' BEGIN
 UPDATE bank_inbox SET status='pending',posted_transaction_id=NULL WHERE owner_id=OLD.owner_id AND posted_transaction_id=OLD.id AND status='posted';
END;
