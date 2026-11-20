//! JNI wrapper only; banking data parsing is in finance-core (Rust).
use jni::{objects::{JObject, JString}, sys::jstring, JNIEnv};

#[no_mangle]
pub extern "system" fn Java_com_tridat_finance_BankNotificationListener_parseBankNotification(
    mut env: JNIEnv,
    _this: JObject,
    content: JString,
) -> jstring {
    let input: String = match env.get_string(&content) {
        Ok(s) => s.into(),
        Err(_) => return std::ptr::null_mut(),
    };
    let value = match finance_core::parse_bank_notification(&input) {
        Ok(candidate) => serde_json::json!({"ok":true,"candidate":candidate,"pending_review":true}),
        Err(reason) => serde_json::json!({"ok":false,"reason":reason}),
    };
    match env.new_string(value.to_string()) {
        Ok(s) => s.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}
