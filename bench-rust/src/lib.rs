//! Browser performance harness calling the actual migration formatting-rs port.
//! This is a microbenchmark of ONE ported unit, not a replacement for the finance app.
use wasm_bindgen::prelude::*;
use serde_json::Value;

#[wasm_bindgen]
pub fn format_date_batch(input_json: &str) -> Result<String, JsValue> {
    let items: Vec<String> = serde_json::from_str(input_json)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    let result: Result<Vec<_>, JsValue> = items.into_iter().map(|s| {
        let date = formatting_rs::port::format_date(Value::String(s))
            .map_err(|e| JsValue::from_str(&e))?;
        date.as_str()
            .map(ToOwned::to_owned)
            .ok_or_else(|| JsValue::from_str("Rust formatter returned non-string"))
    }).collect();
    serde_json::to_string(&result?).map_err(|e| JsValue::from_str(&e.to_string()))
}
