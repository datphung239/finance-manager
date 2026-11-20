#!/usr/bin/env python3
"""Fail closed before deploying Finance Manager V2 to Cloudflare."""
import sys
import tomllib
import uuid
from pathlib import Path

if len(sys.argv)!=2:
    raise SystemExit("Usage: python3 next/scripts/preflight.py next/server/wrangler.toml")
path=Path(sys.argv[1])
if not path.is_file():
    raise SystemExit("ERROR: create a local V2 config from wrangler.toml.example first")
conf=tomllib.loads(path.read_text(encoding="utf-8"))
assert conf.get("name") == "finance-manager-v2", "Refusing non-V2 Worker target"
assert conf.get("workers_dev") is True, "V2 Worker URL is required for review"
assert conf.get("main") == "build/worker/shim.mjs", "Worker entry missing"
assert conf.get("assets",{}).get("directory") == "../dist", "V2 assets path mismatch"
items=conf.get("d1_databases",[])
assert len(items)==1, "Only the NEW V2 D1 binding may be present"
item=items[0]
assert item.get("binding")=="DB", "D1 binding must be DB"
assert item.get("database_name")=="finance-manager-v2", "Refusing another D1 name"
assert item.get("migrations_dir")=="../migrations", "Wrong migration directory"
raw=item.get("database_id","")
try:
    database=uuid.UUID(raw)
except (ValueError, AttributeError):
    raise SystemExit("ERROR: replace SET_REAL_DATABASE_ID_HERE with the NEW D1 UUID")
assert str(database)==raw.lower(), "Database UUID is invalid"
assert (path.parent/"../migrations/0004_debt_request_id.sql").resolve().is_file(), "Missing D1 migrations"
assert (path.parent/"../dist/index.html").resolve().is_file(), "Run the Rust client build first"
assert (path.parent/"../dist/pkg/finance_client_bg.wasm").resolve().is_file(), "Missing Rust WASM client"
print("PASS: separate V2 Worker, new D1 binding and Rust static assets found")
print("VERIFY BY HAND: this UUID belongs to a freshly created EMPTY D1, Access is enforced, and secrets are configured")
