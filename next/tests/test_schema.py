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
