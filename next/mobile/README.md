# Mobile adapters (native OS boundaries)

## Android
- App UI should open the Rust/WASM frontend in Android WebView.
- `NotificationListenerService` is implemented by a *minimal Kotlin OS adapter*.
  Android requires the Java/Kotlin Android SDK layer to implement this service.
  Business validation and parsing are in the Rust `finance-core` JNI library.
- Users must manually grant Notification Access and allowlist only approved bank
  application package IDs. Never read OTP, security messages or unrelated apps.
- Current native adapter **DOES NOT UPLOAD OR AUTO-POST**. Device enrollment,
  signing, protected background synchronization and QA are mandatory before that.
- Cloudflare Access service tokens must NEVER be baked into APKs.

## iOS
- Apple does not offer arbitrary third-party apps an Android-equivalent listener
  for bank app push notifications. WebView can run the Rust/WASM UI, but cannot
  inspect other apps' notifications.
- Supported design: direct bank API where authorized, email parsing with user
  consent, or iOS Share Extension / manual import. No false promise of automatic
  third-party push scraping.
- Requires Apple developer signing, iOS packaging and human device testing.

## Critical missing real-world data
- Bank app package IDs, notification templates (redact any account/transaction IDs).
- Is `nợ` receivable/payable, card balance, or only reconciled bank-account cashflow?
- Device authorization and data-retention policy.
