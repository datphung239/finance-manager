#!/usr/bin/env python3
import sqlite3
from pathlib import Path

script=Path("next/migrations/0001_init.sql").read_text()
db=sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
db.executescript(script)
expected={"accounts","categories","counterparties","debts","transactions","bank_inbox","audit_log"}
found={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
assert expected.issubset(found), expected-found
db.execute("INSERT INTO accounts(id,owner_id,name,kind) VALUES ('a','u1','Tiền mặt','cash')")
db.execute("INSERT INTO accounts(id,owner_id,name,kind) VALUES ('b','u1','Ngân hàng','bank')")
db.execute("""INSERT INTO transactions(id,owner_id,request_id,occurred_at,kind,amount_vnd,account_id)
              VALUES ('t1','u1','req01','2026-11-20','income',200000,'a')""")
try:
    db.execute("""INSERT INTO transactions(id,owner_id,request_id,occurred_at,kind,amount_vnd,account_id)
                  VALUES ('t2','u1','req01','2026-11-20','expense',300000,'a')""")
    raise AssertionError("duplicate request_id was accepted")
except sqlite3.IntegrityError: pass
try:
    db.execute("""INSERT INTO transactions(id,owner_id,request_id,occurred_at,kind,amount_vnd,account_id)
                  VALUES ('t3','u1','req03','2026-11-20','income',-1,'a')""")
    raise AssertionError("negative amount was accepted")
except sqlite3.IntegrityError: pass
try:
    db.execute("""INSERT INTO transactions(id,owner_id,request_id,occurred_at,kind,amount_vnd,account_id,other_account_id)
                  VALUES ('t4','u1','req04','2026-11-20','transfer',1000,'a','a')""")
    raise AssertionError("self-transfer was accepted")
except sqlite3.IntegrityError: pass
db.execute("""INSERT INTO bank_inbox(id,owner_id,source_package,dedupe_key,amount_vnd,flow,redacted_summary)
              VALUES ('b1','u1','bank.pkg','hash01',100000,'credit','Tiền vào 100000 VND')""")
try:
    db.execute("""INSERT INTO bank_inbox(id,owner_id,source_package,dedupe_key,amount_vnd,flow,redacted_summary)
                  VALUES ('b2','u1','bank.pkg','hash01',100000,'credit','Tiền vào 100000 VND')""")
    raise AssertionError("duplicate notification was accepted")
except sqlite3.IntegrityError: pass
print("PASS: D1 schema, positive integer VND, idempotency, transfer invariant, inbox dedupe")

db.executescript(Path("next/migrations/0002_debt_settlement.sql").read_text())
db.execute("INSERT INTO counterparties(id,owner_id,name) VALUES('p1','u1','Người mẫu')")
db.execute("""INSERT INTO debts(id,owner_id,counterparty_id,direction,principal_vnd,title)
             VALUES('d1','u1','p1','receivable',100000,'Nợ phải thu')""")
db.execute("""INSERT INTO transactions(id,owner_id,request_id,occurred_at,kind,amount_vnd,account_id,debt_id)
             VALUES('s1','u1','req-s1','2026-11-20','debt_collection',40000,'a','d1')""")
settled=db.execute("SELECT settled_vnd FROM debts WHERE id='d1'").fetchone()[0]
assert settled==40000, settled
try:
    db.execute("""INSERT INTO transactions(id,owner_id,request_id,occurred_at,kind,amount_vnd,account_id,debt_id)
                 VALUES('s2','u1','req-s2','2026-11-20','debt_collection',90000,'a','d1')""")
    raise AssertionError("debt overpayment accepted")
except sqlite3.IntegrityError: pass
assert db.execute("SELECT settled_vnd FROM debts WHERE id='d1'").fetchone()[0]==40000
db.execute("UPDATE transactions SET deleted_at=datetime('now') WHERE id='s1'")
assert db.execute("SELECT settled_vnd FROM debts WHERE id='d1'").fetchone()[0]==0
print("PASS: atomic debt settlement, overpayment rejection and soft-delete reversal")


# Fresh D1 migrations: tenant ownership, account kinds and reversal.
db.executescript(Path("next/migrations/0003_tenant_guards.sql").read_text())
db.execute("INSERT INTO accounts(id,owner_id,name,kind) VALUES('card1','u1','Thẻ Demo','credit_card')")
db.execute("INSERT INTO accounts(id,owner_id,name,kind) VALUES('other','u2','Tiền khách khác','bank')")
db.execute("INSERT INTO categories(id,owner_id,name,kind) VALUES('ci','u1','Thu','income')")
db.execute("INSERT INTO categories(id,owner_id,name,kind) VALUES('ce','u1','Chi','expense')")
db.execute("INSERT INTO categories(id,owner_id,name,kind) VALUES('c-other','u2','Chi khác','expense')")

def must_reject(sql, label):
    try:
        db.execute(sql)
    except sqlite3.IntegrityError:
        return
    raise AssertionError("D1 incorrectly permitted: " + label)

must_reject("""INSERT INTO transactions(id,owner_id,request_id,occurred_at,kind,amount_vnd,account_id)
 VALUES('x1','u1','cross01','2026-11-20','income',1000,'other')""", "other user's account")
must_reject("""INSERT INTO transactions(id,owner_id,request_id,occurred_at,kind,amount_vnd,account_id,other_account_id)
 VALUES('x2','u1','cross02','2026-11-20','transfer',1000,'a','other')""", "other user's transfer destination")
must_reject("""INSERT INTO transactions(id,owner_id,request_id,occurred_at,kind,amount_vnd,account_id,category_id)
 VALUES('x3','u1','cross03','2026-11-20','expense',1000,'a','c-other')""", "other user's category")
must_reject("""INSERT INTO transactions(id,owner_id,request_id,occurred_at,kind,amount_vnd,account_id,category_id)
 VALUES('x4','u1','cross04','2026-11-20','expense',1000,'a','ci')""", "income category used as expense")
must_reject("""INSERT INTO transactions(id,owner_id,request_id,occurred_at,kind,amount_vnd,account_id)
 VALUES('x5','u1','cross05','2026-11-20','card_charge',1000,'a')""", "card charge to cash account")
must_reject("""INSERT INTO transactions(id,owner_id,request_id,occurred_at,kind,amount_vnd,account_id,other_account_id)
 VALUES('x6','u1','cross06','2026-11-20','card_payment',1000,'a','b')""", "card payment to another bank")
db.execute("""INSERT INTO transactions(id,owner_id,request_id,occurred_at,kind,amount_vnd,account_id,other_account_id)
 VALUES('ok-card','u1','cardpay1','2026-11-20','card_payment',1000,'a','card1')""")
db.execute("""INSERT INTO transactions(id,owner_id,request_id,occurred_at,kind,amount_vnd,account_id,source)
 VALUES('bank-post-1','u1','bankpost1','2026-11-20','income',25000,'a','bank_notification')""")
db.execute("UPDATE bank_inbox SET status='posted',posted_transaction_id='bank-post-1' WHERE id='b1'")
db.execute("UPDATE transactions SET deleted_at=datetime('now') WHERE id='bank-post-1'")
assert db.execute("SELECT status,posted_transaction_id FROM bank_inbox WHERE id='b1'").fetchone() == ('pending', None)
db.execute("INSERT INTO counterparties(id,owner_id,name) VALUES('owner2','u2','Đối tác riêng')")
must_reject("""INSERT INTO debts(id,owner_id,counterparty_id,direction,principal_vnd,title)
 VALUES('xdebt','u1','owner2','receivable',1000,'Nợ sai chủ')""", "cross-owner debt")
print("PASS: D1 owner/category/account guards and bank-post reversal")
