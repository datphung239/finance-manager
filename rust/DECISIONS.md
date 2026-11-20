# Architecture decisions — initial

## ADR-001 — Keep main production untouched
Decision: All migration work stays on migration/rust-anything-whole-app. No deploy or merge until parity and browser E2E pass.

## ADR-002 — Browser-first runtime
The original uses DOM, fetch, Google Identity Services, browser storage and Chart.js; it is NOT a CLI or Node server. Target: Rust compiled to WASM for business logic and eventually UI. Retain HTML/CSS as necessary static web assets. No misleading pure binary lift claim.

## ADR-003 — Preserve finance contract
Treat signed amounts, categories DT-/CP-/TTT_, currency formatting, month boundaries, duplicated submits and recovery of pending mutations as invariants. Any divergences must fail a gate, never be "normalized" without review.

## ADR-004 — Tests and side effects
Only safe pure functions are passed to rust-anything unit recorder. For request or mutation units use offline mocks + synthetic identifiers; never real endpoint or Google credentials.

## ADR-005 — No server migration without server source
Backend is Google Apps Script external to this repository. A complete Rust backend replacement is out of scope until source and deployment specification are available.
