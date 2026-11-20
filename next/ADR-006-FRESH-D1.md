# ADR-006: Fresh D1, no historical import

Approved 2026-11-20: Finance Manager V2 starts with a **new, empty** database.
No Google Sheets migration, Google Apps Script sync, automatic historical
backfill or secret reuse. The new runtime uses Rust + D1 only.

Initial business tables have zero rows. Users enter accounts and opening
balances manually. An opening balance is **not** counted as revenue.

Old Sheets and the deployed V1 app are left unchanged as an archive.
Choosing a fresh database is not permission to erase old files, merge into
main, or replace the currently published Worker.

V2 deployment requires its own Worker, D1 database, restricted Cloudflare
Access policy and Worker secrets. Bank notifications are review candidates;
do not infer a receivable/payable debt from a generic deposit or debit.

Production must remain locked until a remote D1/Access smoke test passes.
