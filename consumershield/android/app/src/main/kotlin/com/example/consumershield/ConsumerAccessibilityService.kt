package com.example.consumershield

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.os.SystemClock
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

class ConsumerAccessibilityService : AccessibilityService() {
    companion object {
        const val ACTION_SCREEN_TEXT = "com.example.consumershield.ACTION_SCREEN_TEXT"
        private val TARGET_PACKAGES = setOf(
            "in.swiggy.android",
            "com.application.zomato",
            "com.amazon.mShop.android.shopping"
        )
        private const val THROTTLE_MS = 750L
    }

    private var lastBroadcastAt = 0L
    private var lastPayload = ""

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val packageName = event?.packageName?.toString().orEmpty()
        if (packageName.isEmpty() || packageName !in TARGET_PACKAGES) return

        val root = rootInActiveWindow ?: return
        val visibleText = buildString {
            extractVisibleText(root, this)
        }.replace(Regex("\\s+"), " ").trim()

        if (visibleText.isEmpty()) return

        val now = SystemClock.elapsedRealtime()
        val payload = "$packageName::$visibleText"
        if (payload == lastPayload && now - lastBroadcastAt < THROTTLE_MS) return

        lastPayload = payload
        lastBroadcastAt = now

        val intent = Intent(ACTION_SCREEN_TEXT).apply {
            setPackage(applicationContext.packageName)
            putExtra("text", visibleText)
            putExtra("package", packageName)
        }
        sendBroadcast(intent)
    }

    private fun extractVisibleText(node: AccessibilityNodeInfo, builder: StringBuilder) {
        node.text?.takeIf { it.isNotBlank() }?.let {
            builder.append(it).append(" | ")
        }
        node.contentDescription?.takeIf { it.isNotBlank() }?.let {
            builder.append(it).append(" | ")
        }

        for (index in 0 until node.childCount) {
            node.getChild(index)?.let { extractVisibleText(it, builder) }
        }
    }

    override fun onInterrupt() = Unit
}