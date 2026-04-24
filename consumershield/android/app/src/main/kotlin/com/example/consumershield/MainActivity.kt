package com.example.consumershield

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.provider.Settings
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val methodChannelName = "consumer_scanner/methods"
    private val eventChannelName = "consumer_scanner/screen_text_stream"
    private var streamSink: EventChannel.EventSink? = null
    private var screenTextReceiver: BroadcastReceiver? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, methodChannelName)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "isAccessibilityServiceEnabled" -> result.success(isAccessibilityServiceEnabled())
                    "openAccessibilitySettings" -> {
                        startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                        result.success(true)
                    }
                    else -> result.notImplemented()
                }
            }

        EventChannel(flutterEngine.dartExecutor.binaryMessenger, eventChannelName)
            .setStreamHandler(object : EventChannel.StreamHandler {
                override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
                    streamSink = events
                    if (screenTextReceiver == null) {
                        screenTextReceiver = object : BroadcastReceiver() {
                            override fun onReceive(context: Context?, intent: Intent?) {
                                val data = mapOf(
                                    "text" to intent?.getStringExtra("text"),
                                    "package" to intent?.getStringExtra("package")
                                )
                                streamSink?.success(data)
                            }
                        }
                        val filter = IntentFilter(ConsumerAccessibilityService.ACTION_SCREEN_TEXT)
                        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                            registerReceiver(screenTextReceiver, filter, Context.RECEIVER_EXPORTED)
                        } else {
                            registerReceiver(screenTextReceiver, filter)
                        }
                    }
                }

                override fun onCancel(arguments: Any?) {
                    streamSink = null
                    screenTextReceiver?.let { unregisterReceiver(it) }
                    screenTextReceiver = null
                }
            })
    }

    private fun isAccessibilityServiceEnabled(): Boolean {
        val enabledServices = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
            ?: return false
        val serviceId = ComponentName(this, ConsumerAccessibilityService::class.java).flattenToString()
        return enabledServices.split(':').any { it.equals(serviceId, ignoreCase = true) }
    }
}
