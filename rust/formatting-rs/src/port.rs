//! Exact-behavior Rust port of browser date formatting functions.
#![forbid(unsafe_code)]
use serde_json::Value;

fn js_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(v) => *v,
        Value::Number(n) => n.as_f64().is_some_and(|v| v != 0.0 && !v.is_nan()),
        Value::String(v) => !v.is_empty(),
        Value::Array(_) => true,
        Value::Object(_) if crate::js::is_undefined(value) => false,
        Value::Object(_) => crate::js::as_number(value)
            .is_none_or(|v| v != 0.0 && !v.is_nan()),
    }
}

fn js_string(value: &Value) -> String {
    match value {
        Value::Null => "null".into(),
        Value::Bool(v) => v.to_string(),
        Value::String(v) => v.clone(),
        Value::Number(n) => n.as_f64().map_or_else(String::new, crate::js::number_to_string),
        Value::Array(values) => values.iter()
            .map(|v| if v.is_null() || crate::js::is_undefined(v) {
                String::new()
            } else { js_string(v) })
            .collect::<Vec<_>>().join(","),
        Value::Object(_) if crate::js::is_undefined(value) => "undefined".into(),
        Value::Object(_) => crate::js::as_number(value)
            .map_or_else(|| "[object Object]".into(), crate::js::number_to_string),
    }
}

fn js_pad2(value: &str) -> String {
    format!("{}{}", "0".repeat(2usize.saturating_sub(value.encode_utf16().count())), value)
}

/// Port of convertDisplayToInputDate from the original app.
pub fn convert_display_to_input_date(d_str: Value) -> Result<Value, String> {
    if !js_truthy(&d_str) { return Ok(Value::String(String::new())); }
    let Value::String(input) = d_str else {
        return Err("dStr.split is not a function".into());
    };
    let parts: Vec<_> = input.split('/').collect();
    Ok(Value::String(if parts.len() == 3 {
        format!("{}-{}-{}", parts[2], js_pad2(parts[1]), js_pad2(parts[0]))
    } else { input }))
}

/// Port of formatDate from the original app.
pub fn format_date(value: Value) -> Result<Value, String> {
    if !js_truthy(&value) { return Ok(Value::String(String::new())); }
    let clean = js_string(&value).replacen('\'', "", 1).trim().to_owned();
    let parts: Vec<_> = if clean.contains('/') {
        clean.split('/').collect()
    } else { clean.split('-').collect() };
    if parts.len() != 3 { return Ok(Value::String(clean)); }
    Ok(Value::String(if clean.contains('-') {
        format!("{}/{}/{}", js_pad2(parts[2]), js_pad2(parts[1]), parts[0])
    } else {
        format!("{}/{}/{}", js_pad2(parts[0]), js_pad2(parts[1]), js_pad2(parts[2]))
    }))
}

