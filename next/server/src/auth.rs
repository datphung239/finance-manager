//! Access JWT validation is mandatory before every D1 request.
//! A client-supplied email header is NEVER trusted as identity.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use js_sys::{Array, Date, Function, Promise, Reflect, Uint8Array};
use serde_json::{json, Value};
use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_futures::JsFuture;
use worker::{Env, Fetch, Request, Url};

#[derive(Clone)]
pub struct AccessUser {
    pub sub: String,
    pub email: String,
}

async fn invoke(object: &JsValue, method: &str, args: &[JsValue]) -> Result<JsValue, String> {
    let function: Function = Reflect::get(object, &JsValue::from_str(method))
        .map_err(|_| "Crypto API is unavailable")?
        .dyn_into()
        .map_err(|_| "WebCrypto function unavailable")?;
    let array = Array::new();
    for arg in args { array.push(arg); }
    let promise: Promise = function.apply(object, &array)
        .map_err(|_| "WebCrypto invocation failed")?
        .dyn_into()
        .map_err(|_| "WebCrypto did not return a Promise")?;
    JsFuture::from(promise).await.map_err(|_| "WebCrypto operation failed".to_owned())
}

async fn check_rs256(signing_input: &[u8], signature: &[u8], jwk: &Value) -> Result<bool, String> {
    let global = js_sys::global();
    let crypto = Reflect::get(&global, &JsValue::from_str("crypto"))
        .map_err(|_| "Crypto unavailable")?;
    let subtle = Reflect::get(&crypto, &JsValue::from_str("subtle"))
        .map_err(|_| "SubtleCrypto unavailable")?;
    let jwk_js = serde_wasm_bindgen::to_value(jwk).map_err(|_| "Invalid JWK")?;
    let params = serde_wasm_bindgen::to_value(&json!({
        "name": "RSASSA-PKCS1-v1_5", "hash": "SHA-256"
    })).map_err(|_| "Invalid import algorithm")?;
    let usages = Array::new();
    usages.push(&JsValue::from_str("verify"));
    let key = invoke(&subtle, "importKey", &[
        JsValue::from_str("jwk"), jwk_js, params,
        JsValue::FALSE, usages.into()
    ]).await?;
    let sig = Uint8Array::from(signature);
    let bytes = Uint8Array::from(signing_input);
    let verified = invoke(&subtle, "verify", &[
        JsValue::from_str("RSASSA-PKCS1-v1_5"),
        key, sig.into(), bytes.into()
    ]).await?;
    Ok(verified.as_bool() == Some(true))
}

pub async fn require_user(req: &Request, env: &Env) -> Result<AccessUser, String> {
    // Fail closed if Zero Trust has not been configured yet.
    let team = env.secret("ACCESS_TEAM_DOMAIN")
        .map_err(|_| "Access configuration missing")?.to_string();
    let aud = env.secret("ACCESS_AUD")
        .map_err(|_| "Access audience missing")?.to_string();
    let allowlist = env.secret("ACCESS_ALLOWED_EMAILS")
        .map_err(|_| "Access email allowlist missing")?.to_string();
    let team = team.trim_end_matches('/');
    if !team.starts_with("https://") ||
       !team.ends_with(".cloudflareaccess.com") ||
       team.matches('/').count() != 2 {
        return Err("Invalid Access team domain".into());
    }
    if aud.len() < 8 || allowlist.trim().is_empty() {
        return Err("Access policy is incomplete".into());
    }
    let token = req.headers().get("Cf-Access-Jwt-Assertion")
        .map_err(|_| "Missing Access JWT")?
        .ok_or("Missing Access JWT")?;
    if token.len() > 8192 { return Err("Access JWT too long".into()); }
    let chunks: Vec<_> = token.split('.').collect();
    if chunks.len() != 3 { return Err("Malformed Access JWT".into()); }
    let header: Value = serde_json::from_slice(
        &URL_SAFE_NO_PAD.decode(chunks[0]).map_err(|_| "Invalid header encoding")?
    ).map_err(|_| "Invalid JWT header")?;
    if header.get("alg").and_then(Value::as_str) != Some("RS256") {
        return Err("Unexpected JWT algorithm".into());
    }
    let kid = header.get("kid").and_then(Value::as_str).ok_or("Missing JWT key id")?;
    let payload: Value = serde_json::from_slice(
        &URL_SAFE_NO_PAD.decode(chunks[1]).map_err(|_| "Invalid payload encoding")?
    ).map_err(|_| "Invalid JWT payload")?;
    let now = (Date::now() / 1000.0) as i64;
    let exp = payload.get("exp").and_then(Value::as_i64).ok_or("Missing expiry")?;
    if exp <= now || exp > now + 86400 * 30 { return Err("Invalid expiry".into()); }
    if payload.get("nbf").and_then(Value::as_i64).is_some_and(|nbf| nbf > now) {
        return Err("JWT not yet valid".into());
    }
    if payload.get("iss").and_then(Value::as_str) != Some(team) {
        return Err("JWT issuer mismatch".into());
    }
    let audience_matches = match payload.get("aud") {
        Some(Value::String(s)) => s == &aud,
        Some(Value::Array(items)) => items.iter().any(|v| v.as_str() == Some(&aud)),
        _ => false,
    };
    if !audience_matches { return Err("JWT audience mismatch".into()); }
    let subject = payload.get("sub").and_then(Value::as_str).ok_or("Subject missing")?;
    let email = payload.get("email").and_then(Value::as_str)
        .ok_or("Email missing")?.to_lowercase();
    if subject.len() < 8 || email.len() > 250 ||
       !allowlist.split(',').map(|v| v.trim().to_lowercase()).any(|v| v == email) {
        return Err("Account not on allowlist".into());
    }

    let url = Url::parse(&format!("{team}/cdn-cgi/access/certs"))
        .map_err(|_| "Cannot build certificate URL")?;
    let mut cert_response = Fetch::Url(url).send().await
        .map_err(|_| "Could not retrieve Access certs")?;
    if cert_response.status_code() != 200 {
        return Err("Access cert endpoint unavailable".into());
    }
    let keys: Value = cert_response.json().await.map_err(|_| "Invalid Access JWKS")?;
    let jwk = keys.get("keys").and_then(Value::as_array)
        .and_then(|keys| keys.iter().find(|v| {
            v.get("kid").and_then(Value::as_str) == Some(kid) &&
            v.get("kty").and_then(Value::as_str) == Some("RSA")
        })).ok_or("Access signing key not found")?;
    let signature = URL_SAFE_NO_PAD.decode(chunks[2]).map_err(|_| "Invalid signature encoding")?;
    let signing = format!("{}.{}", chunks[0], chunks[1]);
    if !check_rs256(signing.as_bytes(), &signature, jwk).await? {
        return Err("JWT signature invalid".into());
    }
    Ok(AccessUser { sub: subject.into(), email })
}
