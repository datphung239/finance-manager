use serde_json::{Value, json};
use validators_rs::port::{
    is_bootstrap_shape, is_card_view_shape, is_cash_dashboard_shape, is_initial_data_shape,
    is_transaction_list_shape,
};

#[test]
fn canonical_valid_schemas() {
    let initial = json!({"cards":[],"categories":[],"merchants":[],"cashCategories":[],
        "cashCPCategories":[],"cashMerchants":[]});
    let card = json!({"dashboard":{"kpi":{},"statements":[],"filters":{}},"categoryReport":[]});
    let cash = json!({"period":{},"paymentData":{},"monthTrends":[],"ratioTableData":{},
        "frequencyData":{},"dailyData":{},"targetData":{},"businessData":
        {"result":[],"revenueExpense":[]}});
    assert_eq!(
        is_initial_data_shape(initial.clone()),
        Ok(Value::Bool(true))
    );
    assert_eq!(is_card_view_shape(card.clone()), Ok(Value::Bool(true)));
    assert_eq!(is_cash_dashboard_shape(cash.clone()), Ok(Value::Bool(true)));
    assert_eq!(
        is_bootstrap_shape(json!({"initialData":initial.clone(),"cardView":card.clone()})),
        Ok(Value::Bool(true))
    );
    assert_eq!(
        is_bootstrap_shape(json!({"initialData":initial,"cardView":card,
        "cashDashboard":cash})),
        Ok(Value::Bool(true))
    );
    assert_eq!(
        is_transaction_list_shape(json!([{}, []])),
        Ok(Value::Bool(true))
    );
}

#[test]
fn rejects_incomplete_and_null_transaction_rows() {
    assert_eq!(
        is_initial_data_shape(json!({"cards":[]})),
        Ok(Value::Bool(false))
    );
    assert_eq!(is_bootstrap_shape(json!({})), Ok(Value::Bool(false)));
    assert_eq!(
        is_transaction_list_shape(json!([{}, null])),
        Ok(Value::Bool(false))
    );
    assert_eq!(is_transaction_list_shape(json!([])), Ok(Value::Bool(true)));
}
