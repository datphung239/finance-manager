# Finance Manager v2 (Rust + Cloudflare D1 + Access)

**STATUS: rebuild in progress. NOT production-ready.**

This lives under `next/` in a dedicated branch and does not modify the existing
Finance Manager deployment, Google Sheets or Apps Script.

## Architecture
- Rust `finance-core`: money and validation, no JavaScript business logic.
- Rust `workers-rs` Worker: authenticated API and D1 operations.
- Rust browser client: WASM generated UI; HTML/CSS are static assets.
- Cloudflare Access: edge login, plus JWT signature/audience/issuer verification in Worker.
- D1: independent empty SQL database, provisioned explicitly after validation.
- Android: native notification listener requires Android framework glue; Rust parses.
- iOS: does not permit listening to other bank apps' push notifications. Use bank
  API/email integration or user-initiated share/import, never an unsupported promise.

## Invariants
1. Money is integer VND, never float.
2. All tables are tenant scoped by verified Cloudflare Access subject/email.
3. No write may use authenticated identity from a client-supplied header.
4. Repeated request IDs cannot duplicate transactions; all mutations audited.
5. Bank push events enter a confirmation inbox, never auto-create 'debt'.
6. No production deploy until Access, D1 ID, accounts and E2E are verified.
7. New D1 starts empty; no Google Sheets data import or sync. See ADR-006.

## How to test the shared domain
```
cargo test --manifest-path next/core/Cargo.toml
```

## Blocking decisions
- Exact definition of 'nợ' from bank notifications: receivable/payable or account balance.
- Which bank Android packages and redacted notification examples; never send tokens/OTP.
- Who can sign in (Access allowlisted email addresses or groups).
- Provision the NEW Cloudflare D1/Access/secrets in the user's account before deployment.
