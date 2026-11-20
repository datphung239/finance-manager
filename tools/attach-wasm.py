#!/usr/bin/env python3
"""Embed the compiled wasm-bindgen no-modules bundle into the three-file Cloudflare build."""
from pathlib import Path
import base64,sys
app=Path("app.js")
text=app.read_text(encoding="utf-8")
start="// === BEGIN GENERATED RUST/WASM BENCHMARK ==="
end="// === END GENERATED RUST/WASM BENCHMARK ==="
if start in text:
    if end not in text:
        raise SystemExit("Missing generated bundle closing marker")
    text=text[:text.index(start)] + text[text.index(end)+len(end):]
glue=Path("bench-output/bench_port.js").read_text(encoding="utf-8")
wasm=Path("bench-output/bench_port_bg.wasm").read_bytes()
print("WASM",len(wasm),"bytes; glue",len(glue),"bytes")
encoded=base64.b64encode(wasm).decode("ascii")
generated="\n"+start+"\n"+glue+"\nconst BENCH_WASM_BASE64 = '"+encoded+"';\n"+end+"\n"
app.write_text(text.rstrip()+"\n"+generated,encoding="utf-8")
