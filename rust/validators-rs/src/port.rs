//! JS-compatible data-shape validators for the finance-manager browser API.
#![forbid(unsafe_code)]
use serde_json::Value;

fn objectish(value: &Value) -> bool {
    value.is_object() || value.is_array()
}

fn truthy(value: Option<&Value>) -> bool {
    let Some(v) = value else { return false };
    if crate::js::is_undefined(v) { return false; }
    match v {
        Value::Null => false,
        Value::Bool(v) => *v,
        Value::String(s) => !s.is_empty(),
        Value::Number(n) => n.as_f64().is_some_and(|n| n != 0.0 && !n.is_nan()),
        Value::Object(_) => crate::js::as_number(v).is_none_or(|n| n != 0.0 && !n.is_nan()),
        Value::Array(_) => true,
    }
}

fn initial_ok(v: &Value) -> bool {
    objectish(v) && [
        "cards", "categories", "merchants", "cashCategories", "cashCPCategories", "cashMerchants"
    ].iter().all(|name| v.get(*name).is_some_and(Value::is_array))
}

fn card_ok(v: &Value) -> bool {
    let Some(d) = v.get("dashboard") else { return false };
    objectish(v) && objectish(d) &&
    d.get("kpi").is_some_and(objectish) &&
    d.get("statements").is_some_and(Value::is_array) &&
    d.get("filters").is_some_and(objectish) &&
    v.get("categoryReport").is_some_and(Value::is_array)
}

fn cash_ok(v: &Value) -> bool {
    let Some(business) = v.get("businessData") else { return false };
    objectish(v) && [
        "period", "paymentData", "ratioTableData", "frequencyData",
        "dailyData", "targetData", "businessData"
    ].iter().all(|name| truthy(v.get(*name))) &&
    v.get("monthTrends").is_some_and(Value::is_array) &&
    business.get("result").is_some_and(Value::is_array) &&
    business.get("revenueExpense").is_some_and(Value::is_array)
}

/// Port of isInitialDataShape (src/validators.js).
pub fn is_initial_data_shape(data: Value) -> Result<Value, String> {
    Ok(Value::Bool(initial_ok(&data)))
}
/// Port of isCardViewShape (src/validators.js).
pub fn is_card_view_shape(view: Value) -> Result<Value, String> {
    Ok(Value::Bool(card_ok(&view)))
}
/// Port of isCashDashboardShape (src/validators.js).
pub fn is_cash_dashboard_shape(data: Value) -> Result<Value, String> {
    Ok(Value::Bool(cash_ok(&data)))
}
/// Port of isBootstrapShape (src/validators.js).
pub fn is_bootstrap_shape(data: Value) -> Result<Value, String> {
    let valid = truthy(Some(&data)) &&
        data.get("initialData").is_some_and(initial_ok) &&
        data.get("cardView").is_some_and(card_ok) &&
        match data.get("cashDashboard") {
            None => true,
            Some(v) if crate::js::is_undefined(v) => true,
            Some(v) => cash_ok(v),
        };
    Ok(Value::Bool(valid))
}
/// Port of isTransactionListShape (src/validators.js).
pub fn is_transaction_list_shape(list: Value) -> Result<Value, String> {
    let valid = list.as_array().is_some_and(|items| {
        items.iter().all(|item| !item.is_null() && objectish(item) && !crate::js::is_undefined(item))
    });
    Ok(Value::Bool(valid))
}
