//! The Rust port of `src/formatting.js`.
//!
//! Replace each `unimplemented!` with the port of the source function. Return `Err` where
//! the source throws or raises: the caller gets an error there too. After changing a
//! signature, run `rust-anything refresh` to regenerate the bindings. `rust-anything diff` checks
//! behavior against what the source recorded.

#![forbid(unsafe_code)]

/// Port of `convertDisplayToInputDate` (`src/formatting.js:3`).
pub fn convert_display_to_input_date(
    d_str: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let _ = &d_str;
    unimplemented!("port `convertDisplayToInputDate` from src/formatting.js")
}

/// Port of `formatDate` (`src/formatting.js:9`).
pub fn format_date(str: serde_json::Value) -> Result<serde_json::Value, String> {
    let _ = &str;
    unimplemented!("port `formatDate` from src/formatting.js")
}
