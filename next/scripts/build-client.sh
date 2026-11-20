#!/usr/bin/env bash
set -euo pipefail
# Run from repository root. Requires Rust wasm32 target and wasm-bindgen-cli 0.2.130.
cargo build --manifest-path next/client/Cargo.toml --release --target wasm32-unknown-unknown
mkdir -p next/dist/pkg
wasm-bindgen --target web --out-name finance_client --out-dir next/dist/pkg \
  next/client/target/wasm32-unknown-unknown/release/finance_client.wasm
cp next/client/index.html next/dist/index.html
cp next/client/v2.css next/dist/v2.css
cp style.css next/dist/style.css
test -s next/dist/pkg/finance_client_bg.wasm
test -s next/dist/pkg/finance_client.js
echo "PASS: Rust/WASM client ready under next/dist/"
