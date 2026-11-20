package com.tridat.finance

import android.app.Notification
import android.content.Intent
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONObject

/**
 * Minimal Android OS adapter. All bank-text interpretation is done by Rust JNI.
 * NO external transfer, no OTP capture and no financial posting from this service.
 *
 * The user must grant Notification Access explicitly in Android Settings.
 * Package IDs must be verified against installed bank apps on the user's device.
 */
class BankNotificationListener : NotificationListenerService() {
    external fun parseBankNotification(text: String): String

    companion object {
        init { System.loadLibrary("finance_bank_android") }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val approved = getSharedPreferences("notification_consent", MODE_PRIVATE)
            .getStringSet("bank_packages", emptySet()) ?: emptySet()
        if (sbn.packageName !in approved) return

        val title = sbn.notification.extras.getCharSequence(Notification.EXTRA_TITLE)
            ?.toString().orEmpty()
        val body = sbn.notification.extras.getCharSequence(Notification.EXTRA_TEXT)
            ?.toString().orEmpty()
        if (body.isBlank()) return
        if (Regex("\\b(otp|mã xác thực|mã bảo mật|verification code)\\b", RegexOption.IGNORE_CASE)
            .containsMatchIn("$title $body")) return

        val candidate = try { JSONObject(parseBankNotification(body)) } catch (_: Exception) { return }
        if (!candidate.optBoolean("ok")) return

        // TODO: encrypt and queue a *minimal* candidate in Android private storage,
        // then enroll this device with Cloudflare Access-backed public-key credentials.
        // We deliberately do NOT put any reusable Cloudflare Service Token in the APK.
        // Never auto-post or call a private D1 API without user authorization.
    }
}
