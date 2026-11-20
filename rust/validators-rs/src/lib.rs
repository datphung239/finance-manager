//! JS bindings for `src/validators.js`: generated from the signatures in `port.rs` by rust-anything.
//! Regenerate with `rust-anything refresh` after changing them.

use wasm_bindgen::prelude::*;

pub mod js;
pub mod port;
pub mod wire;

#[allow(unused_imports)]
use serde_json::Value;

/// `isInitialDataShape`.
fn is_initial_data_shape_inner(data: String) -> Result<String, String> {
    let data = crate::js::from_json(&data)?;
    let out = port::is_initial_data_shape(data)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "isInitialDataShape")]
pub fn is_initial_data_shape(data: String) -> Result<String, JsError> {
    is_initial_data_shape_inner(data).map_err(|e| JsError::new(&e))
}

/// `isCardViewShape`.
fn is_card_view_shape_inner(view: String) -> Result<String, String> {
    let view = crate::js::from_json(&view)?;
    let out = port::is_card_view_shape(view)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "isCardViewShape")]
pub fn is_card_view_shape(view: String) -> Result<String, JsError> {
    is_card_view_shape_inner(view).map_err(|e| JsError::new(&e))
}

/// `isCashDashboardShape`.
fn is_cash_dashboard_shape_inner(data: String) -> Result<String, String> {
    let data = crate::js::from_json(&data)?;
    let out = port::is_cash_dashboard_shape(data)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "isCashDashboardShape")]
pub fn is_cash_dashboard_shape(data: String) -> Result<String, JsError> {
    is_cash_dashboard_shape_inner(data).map_err(|e| JsError::new(&e))
}

/// `isBootstrapShape`.
fn is_bootstrap_shape_inner(data: String) -> Result<String, String> {
    let data = crate::js::from_json(&data)?;
    let out = port::is_bootstrap_shape(data)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "isBootstrapShape")]
pub fn is_bootstrap_shape(data: String) -> Result<String, JsError> {
    is_bootstrap_shape_inner(data).map_err(|e| JsError::new(&e))
}

/// `isTransactionListShape`.
fn is_transaction_list_shape_inner(list: String) -> Result<String, String> {
    let list = crate::js::from_json(&list)?;
    let out = port::is_transaction_list_shape(list)?;
    crate::js::to_json(&out)
}

#[wasm_bindgen(js_name = "isTransactionListShape")]
pub fn is_transaction_list_shape(list: String) -> Result<String, JsError> {
    is_transaction_list_shape_inner(list).map_err(|e| JsError::new(&e))
}

// ---- the binary wire ------------------------------------------------------------------------

thread_local! {
    static WIRE_IN: std::cell::RefCell<Vec<u8>> = const { std::cell::RefCell::new(Vec::new()) };
    static WIRE_OUT: std::cell::RefCell<Vec<u8>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// This module's memory, where `index.cjs` reads and writes the wire buffers.
#[wasm_bindgen(js_name = "rustAnythingWireMemory")]
pub fn rust_anything_wire_memory() -> JsValue {
    wasm_bindgen::memory()
}

/// The address of an argument buffer of `len` bytes.
#[wasm_bindgen(js_name = "rustAnythingWireIn")]
pub fn rust_anything_wire_in(len: u32) -> u32 {
    WIRE_IN.with(|b| {
        let mut b = b.borrow_mut();
        b.resize(len as usize, 0);
        b.as_mut_ptr() as usize as u32
    })
}

/// The address of the last result.
#[wasm_bindgen(js_name = "rustAnythingWireOut")]
pub fn rust_anything_wire_out() -> u32 {
    WIRE_OUT.with(|b| b.borrow().as_ptr() as usize as u32)
}

/// Reads `len` argument bytes, runs `f`, and keeps its result for `rustAnythingWireOut`.
fn wire_io(
    len: u32,
    f: impl FnOnce(&mut wire::Reader, &mut wire::Writer) -> Result<(), String>,
) -> Result<u32, JsError> {
    let input = WIRE_IN.with(|b| std::mem::take(&mut *b.borrow_mut()));
    let mut w = wire::Writer::default();
    let result = f(
        &mut wire::Reader::new(&input[..(len as usize).min(input.len())]),
        &mut w,
    );
    WIRE_IN.with(|b| *b.borrow_mut() = input);
    match result {
        // A result of another shape than the TS type: JS runs the call through JSON.
        Err(e) if e.starts_with(wire::MISMATCH) => return Ok(u32::MAX),
        other => other.map_err(|e| JsError::new(&e))?,
    }
    let n = w.0.len();
    WIRE_OUT.with(|b| *b.borrow_mut() = w.0);
    Ok(u32::try_from(n).unwrap_or(u32::MAX))
}

static S_IS_INITIAL_DATA_SHAPE_0: wire::Schema = wire::Schema::Dyn;
static S_IS_INITIAL_DATA_SHAPE_OUT: wire::Schema = wire::Schema::Dyn;

/// `isInitialDataShape` over the binary wire.
#[wasm_bindgen(js_name = "isInitialDataShapeWire")]
pub fn is_initial_data_shape_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let data: serde_json::Value = wire::read_value(r, &S_IS_INITIAL_DATA_SHAPE_0)?;
        let out = &port::is_initial_data_shape(data)?;
        wire::write_value(w, out, &S_IS_INITIAL_DATA_SHAPE_OUT)?;
        Ok(())
    })
}

static S_IS_CARD_VIEW_SHAPE_0: wire::Schema = wire::Schema::Dyn;
static S_IS_CARD_VIEW_SHAPE_OUT: wire::Schema = wire::Schema::Dyn;

/// `isCardViewShape` over the binary wire.
#[wasm_bindgen(js_name = "isCardViewShapeWire")]
pub fn is_card_view_shape_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let view: serde_json::Value = wire::read_value(r, &S_IS_CARD_VIEW_SHAPE_0)?;
        let out = &port::is_card_view_shape(view)?;
        wire::write_value(w, out, &S_IS_CARD_VIEW_SHAPE_OUT)?;
        Ok(())
    })
}

static S_IS_CASH_DASHBOARD_SHAPE_0: wire::Schema = wire::Schema::Dyn;
static S_IS_CASH_DASHBOARD_SHAPE_OUT: wire::Schema = wire::Schema::Dyn;

/// `isCashDashboardShape` over the binary wire.
#[wasm_bindgen(js_name = "isCashDashboardShapeWire")]
pub fn is_cash_dashboard_shape_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let data: serde_json::Value = wire::read_value(r, &S_IS_CASH_DASHBOARD_SHAPE_0)?;
        let out = &port::is_cash_dashboard_shape(data)?;
        wire::write_value(w, out, &S_IS_CASH_DASHBOARD_SHAPE_OUT)?;
        Ok(())
    })
}

static S_IS_BOOTSTRAP_SHAPE_0: wire::Schema = wire::Schema::Dyn;
static S_IS_BOOTSTRAP_SHAPE_OUT: wire::Schema = wire::Schema::Dyn;

/// `isBootstrapShape` over the binary wire.
#[wasm_bindgen(js_name = "isBootstrapShapeWire")]
pub fn is_bootstrap_shape_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let data: serde_json::Value = wire::read_value(r, &S_IS_BOOTSTRAP_SHAPE_0)?;
        let out = &port::is_bootstrap_shape(data)?;
        wire::write_value(w, out, &S_IS_BOOTSTRAP_SHAPE_OUT)?;
        Ok(())
    })
}

static S_IS_TRANSACTION_LIST_SHAPE_0: wire::Schema = wire::Schema::Dyn;
static S_IS_TRANSACTION_LIST_SHAPE_OUT: wire::Schema = wire::Schema::Dyn;

/// `isTransactionListShape` over the binary wire.
#[wasm_bindgen(js_name = "isTransactionListShapeWire")]
pub fn is_transaction_list_shape_wire(len: u32) -> Result<u32, JsError> {
    wire_io(len, |r, w| {
        let list: serde_json::Value = wire::read_value(r, &S_IS_TRANSACTION_LIST_SHAPE_0)?;
        let out = &port::is_transaction_list_shape(list)?;
        wire::write_value(w, out, &S_IS_TRANSACTION_LIST_SHAPE_OUT)?;
        Ok(())
    })
}
