package com.example.consumershield

import android.accessibilityservice.AccessibilityService
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel

class ConsumerAccessibilityService : AccessibilityService() {
    companion object {
        const val ACTION_TEXT = "com.example.consumershield.SCREEN_TEXT"
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val root = rootInActiveWindow ?: return
        val sb = StringBuilder()
        dumpNode(root, sb)
        
        val intent = Intent(ACTION_TEXT).apply {
            putExtra("text", sb.toString())
            putExtra("package", event?.packageName?.toString() ?: "")
        }
        sendBroadcast(intent)
    }

    private fun dumpNode(node: AccessibilityNodeInfo, sb: StringBuilder) {
        node.text?.let { sb.append(it).append(" | ") }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i)
            if (child != null) dumpNode(child, sb)
        }
    }

    override fun onInterrupt() {}
}

class MainActivity : FlutterActivity() {
    private val CHANNEL = "consumer_scanner/screen_text_stream"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        EventChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL).setStreamHandler(
            object : EventChannel.StreamHandler {
                private var receiver: BroadcastReceiver? = null

                override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
                    receiver = object : BroadcastReceiver() {
                        override fun onReceive(context: Context?, intent: Intent?) {
                            val data = mapOf(
                                "text" to intent?.getStringExtra("text"),
                                "package" to intent?.getStringExtra("package")
                            )
                            events?.success(data)
                        }
                    }
                    val filter = IntentFilter(ConsumerAccessibilityService.ACTION_TEXT)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
                    } else {
                        registerReceiver(receiver, filter)
                    }
                }

                override fun onCancel(arguments: Any?) {
                    receiver?.let { unregisterReceiver(it) }
                    receiver = null
                }
            }
        )
    }
}
