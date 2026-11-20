# Rust migration map — finance-manager

Source of truth: main branch commit 92e1644445522fb11839564454e737de185b442a.
Tool: rust-anything 2.0.0. Workflow: .github/workflows/rust-anything-analyze.yml.

| Unit | Source | Stage | Evidence |
| --- | --- | --- | --- |
| 00 | app.js whole-app | analyzed | GitHub Actions run 44668906712, analyze artifact |
| 01 | src/formatting.js (date formatters) | ported / 24 of 24 diff / strict gate PASS (CI 44670281093) | Node original-equivalence tests; no Rust gate yet |
| 02 | src/validators.js (data schema validators) | extracted; bridge & record in CI | Node original-equivalence tests |
| 03 | amount and category validation | queued | include sign, Vietnamese categories |
| 04 | cache and pending mutations | queued | localStorage; simulated time and failures |
| 05 | request / retry / mutation reconciliation | queued | mock network only; never production endpoint |
| 06 | cash and credit-card aggregation | queued | finance fixtures and invariant checks |
| 07 | dashboard transformation / charts | queued | deterministic visual fixtures |
| 08 | Google auth + browser UI orchestration | blocked on browser-specific integration | Rust/WASM UI and browser E2E |
| 09 | end-to-end user journeys | queued | browser tests + API contract fixtures |

## Boundary

This repository contains a browser client. Its Google Apps Script server source is NOT in this repository. The whole-app report calling it a "library" is not an accurate application runtime model. Port browser logic to WebAssembly/Rust but preserve the API until server source is supplied. Do not run rust-anything app record on the live app because production writes or remote calls could be repeated.

## Gate definition

For each unit: original extraction parity, rust-anything bridge, original record, port.rs implementation, build, diff (zero mismatch), bench, shadow, gate, then browser integration. A unit is NOT complete without a recorded PASS and a traceable git commit.
