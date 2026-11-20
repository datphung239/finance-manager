use formatting_rs::port::{convert_display_to_input_date, format_date};
use serde_json::Value;

#[test]
fn keeps_finance_date_semantics() {
    assert_eq!(
        format_date(Value::from("2026-01-05")),
        Ok(Value::from("05/01/2026"))
    );
    assert_eq!(
        format_date(Value::from("5/1/2026")),
        Ok(Value::from("05/01/2026"))
    );
    assert_eq!(format_date(Value::from(0)), Ok(Value::from("")));
    assert_eq!(
        convert_display_to_input_date(Value::from("5/1/2026")),
        Ok(Value::from("2026-01-05"))
    );
    assert_eq!(
        convert_display_to_input_date(Value::from(true)),
        Err("dStr.split is not a function".to_string())
    );
}
