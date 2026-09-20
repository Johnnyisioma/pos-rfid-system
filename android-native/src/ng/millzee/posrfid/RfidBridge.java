package ng.millzee.posrfid;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.lang.reflect.Method;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * The bridge between the handheld's UHF radio and the POS running in the WebView.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The reader in this device is driven by SEUIC's own app, com.seuic.uhftool.
 * That app owns the radio; nothing else can talk to it directly. What it does
 * offer is an intent interface, and decompiling it (v1.6.22) pins down exactly
 * what that interface is:
 *
 *     broadcast action   com.android.server.scannerservice.broadcast
 *     extra key          scannerdata          (the EPC, as a string)
 *     start scanning     com.android.uhf.startscan
 *     stop scanning      com.android.uhf.stopscan
 *
 * All four are user-editable in the UHF app's settings (dev_broadcast,
 * dev_datakey, dev_start, dev_stop), so configure() lets the POS override them
 * rather than requiring a shop to change them back.
 *
 * ── What this fixes about running in a plain browser ────────────────────────
 *
 * In a browser the reader can only reach the POS by pretending to be a
 * keyboard. The UHF app's "Focus" mode does that through a hidden
 * InputMethodManager.setCommitText call, and it has three problems a shop
 * notices within an hour:
 *
 *   1. It types into whatever field has focus. Tap the wrong box and a
 *      24-character EPC lands in the customer's name.
 *   2. It sends no Enter and no key events at all, so the page has to guess
 *      when a code has finished arriving by watching for a pause.
 *   3. The device ships on Broadcast mode, not Focus. Out of the box the
 *      browser receives nothing, and it looks like the reader is broken.
 *
 * Listening for the broadcast directly removes all three — and lets the POS
 * start and stop the radio itself, which is the difference between holding a
 * trigger down for an hour during a stock take and putting the handheld in a
 * trolley and walking the aisles.
 *
 * ── Why this is not a Capacitor plugin ──────────────────────────────────────
 *
 * There is a Capacitor version of this in android-app/, for building with
 * Android Studio. This one exists because Capacitor, androidx and the Android
 * Gradle Plugin all live on Google's Maven mirrors, and a build environment
 * without access to those can still produce a working APK from the platform
 * SDK alone. It needs no third-party library at all.
 */
public class RfidBridge {

    private static final String TAG = "PosRfid";

    /** SEUIC defaults, confirmed against com.seuic.uhftool 1.6.22. */
    static final String DEFAULT_ACTION   = "com.android.server.scannerservice.broadcast";
    static final String DEFAULT_DATA_KEY = "scannerdata";
    static final String DEFAULT_START    = "com.android.uhf.startscan";
    static final String DEFAULT_STOP     = "com.android.uhf.stopscan";

    /**
     * Other vendors use the same pattern with different strings. Listening for
     * all of them costs nothing and means a Chainway, a Zebra or a Urovo works
     * on day one instead of after a support call.
     */
    private static final String[] EXTRA_ACTIONS = {
        "com.rfid.SCAN",                                  // Chainway / generic
        "android.intent.ACTION_DECODE_DATA",              // Honeywell
        "com.symbol.datawedge.api.RESULT_ACTION",         // Zebra DataWedge
        "nlscan.action.SCANNER_RESULT",                   // Newland
        "com.ubx.scan.result",                            // Urovo
        "scan.rcv.message"                                // iData
    };

    /** Extras those vendors put the code in. The first non-empty one wins. */
    private static final String[] EXTRA_KEYS = {
        DEFAULT_DATA_KEY, "data", "barcode", "EPC", "epc", "tagUii", "value",
        "barcode_string", "com.symbol.datawedge.data_string",
        "SCAN_BARCODE1", "decode_rslt"
    };

    private final Activity activity;
    private final WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());

    private String action = DEFAULT_ACTION;
    private String dataKey = DEFAULT_DATA_KEY;
    private String startAction = DEFAULT_START;
    private String stopAction = DEFAULT_STOP;

    private BroadcastReceiver receiver;
    private boolean listening = false;
    private boolean scanning = false;

    /** Rolling de-duplication: the same tag re-reads many times a second. */
    private final Set<String> recent = new LinkedHashSet<String>();
    private long dedupeMs = 0;                 // 0 = pass everything through

    RfidBridge(Activity activity, WebView web) {
        this.activity = activity;
        this.web = web;
    }

    // ──────────────────────────── called from JavaScript ─────────────────────

    /** What this device is, and whether the software that owns the radio is here. */
    @JavascriptInterface
    public String available() {
        try {
            JSONObject o = new JSONObject();
            o.put("available", true);
            o.put("platform", "android");
            o.put("shell", "native");
            o.put("model", Build.MODEL);
            o.put("manufacturer", Build.MANUFACTURER);
            o.put("device", Build.DEVICE);
            o.put("androidSdk", Build.VERSION.SDK_INT);
            o.put("appVersion", MainActivity.VERSION);
            o.put("listening", listening);
            o.put("scanning", scanning);
            o.put("action", action);
            o.put("dataKey", dataKey);
            // Whether com.seuic.uhftool is installed at all. Without it the
            // broadcast will never arrive however correct the filter is, and
            // the POS should say so rather than sit there looking ready.
            o.put("uhfAppInstalled", isInstalled("com.seuic.uhftool"));
            return o.toString();
        } catch (Exception e) {
            return "{\"available\":true}";
        }
    }

    /**
     * Override the intent strings. A shop that has changed dev_broadcast or
     * dev_datakey in the UHF app passes the new values here instead of having
     * to change them back.
     */
    @JavascriptInterface
    public void configure(String json) {
        try {
            JSONObject o = new JSONObject(json == null ? "{}" : json);
            action = orDefault(o.optString("action", null), DEFAULT_ACTION);
            dataKey = orDefault(o.optString("dataKey", null), DEFAULT_DATA_KEY);
            startAction = orDefault(o.optString("startAction", null), DEFAULT_START);
            stopAction = orDefault(o.optString("stopAction", null), DEFAULT_STOP);
            if (o.has("dedupeMs")) dedupeMs = o.optLong("dedupeMs", 0);
        } catch (Exception e) {
            Log.w(TAG, "configure: " + e.getMessage());
        }
        if (listening) { stopListening(); startListening(); }
    }

    /** Begin delivering tags to the page. Idempotent. */
    @JavascriptInterface
    public void startListening() {
        main.post(new Runnable() { public void run() { registerReceiver(); } });
    }

    @JavascriptInterface
    public void stopListening() {
        main.post(new Runnable() { public void run() { unregisterReceiver(); } });
    }

    /**
     * Pull the trigger from software.
     *
     * This is the capability a browser can never have. A stock take over a
     * thousand pairs of shoes becomes one tap, not a thousand trigger pulls —
     * the radio runs continuously and tags stream in until stopScan().
     */
    @JavascriptInterface
    public void startScan() {
        main.post(new Runnable() {
            public void run() {
                if (!listening) registerReceiver();
                recent.clear();
                sendBare(startAction);
                scanning = true;
                emitState();
            }
        });
    }

    @JavascriptInterface
    public void stopScan() {
        main.post(new Runnable() {
            public void run() {
                sendBare(stopAction);
                scanning = false;
                emitState();
            }
        });
    }

    /**
     * Push a setting into the UHF app: transmit power, region, beep, vibrate.
     *
     * Region matters more than it looks. These handhelds ship configured for
     * FCC 902–928 MHz. In Nigeria the RAIN RFID allocation is 865.6–867.6 MHz
     * at 2 W ERP — the ETSI band — so a device straight out of the box is
     * transmitting on spectrum that is not the shop's to use, and reading
     * badly, because the tags it is reading are tuned for the band it is not on.
     */
    @JavascriptInterface
    public void setReaderSetting(String key, String value) {
        if (key == null || value == null) return;
        Intent intent = new Intent("com.seuic.uhftool.SETTINGS");
        intent.addFlags(Intent.FLAG_INCLUDE_STOPPED_PACKAGES);
        intent.putExtra("key", key);
        intent.putExtra("value", value);
        activity.sendBroadcast(intent);
        Log.d(TAG, "reader setting " + key + "=" + value);
    }

    @JavascriptInterface
    public void resetDedupe() {
        recent.clear();
    }

    /** Short buzz for a good read, a stutter for a problem. */
    @JavascriptInterface
    public void vibrate(int ms) {
        try {
            android.os.Vibrator v =
                (android.os.Vibrator) activity.getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null && v.hasVibrator()) v.vibrate(Math.max(10, Math.min(500, ms)));
        } catch (Exception ignored) { /* a handheld without a motor is still usable */ }
    }

    /** The server address, so the page can show it under Settings. */
    @JavascriptInterface
    public String getServerUrl() {
        return MainActivity.readServerUrl(activity);
    }

    /** Let the shop change server from inside the app. */
    @JavascriptInterface
    public void changeServer() {
        main.post(new Runnable() {
            public void run() { ((MainActivity) activity).promptForServer(true); }
        });
    }

    // ──────────────────────────── trigger key ────────────────────────────────

    /**
     * The physical trigger and the side buttons arrive as key events, which a
     * WebView does not surface to JavaScript in any usable form. Passing them
     * through lets the trigger toggle a sweep, which is what people reach for
     * after using the UHF app.
     */
    boolean onHardwareKey(int keyCode, boolean down) {
        switch (keyCode) {
            case 280: case 281: case 282: case 283:   // SEUIC trigger / side keys
            case 293: case 294:
            case 131:                                  // F1 on some units
                try {
                    JSONObject o = new JSONObject();
                    o.put("keyCode", keyCode);
                    o.put("down", down);
                    emit("triggerKey", o);
                } catch (Exception ignored) { }
                return true;
            default:
                return false;
        }
    }

    // ──────────────────────────── internals ──────────────────────────────────

    private void registerReceiver() {
        if (listening) return;
        IntentFilter filter = new IntentFilter();
        filter.addAction(action);
        for (String a : EXTRA_ACTIONS) if (!a.equals(action)) filter.addAction(a);

        receiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                handleIntent(intent);
            }
        };

        /*
          Android 13 made a runtime receiver declare whether it will hear from
          other apps. This app targets 24, which is exempt — but a future
          target bump would break silently, and the reflective call costs one
          try block. RECEIVER_EXPORTED is 2; it cannot be named here because
          this compiles against the API 23 platform.
        */
        boolean registered = false;
        if (Build.VERSION.SDK_INT >= 33) {
            try {
                Method m = Context.class.getMethod("registerReceiver",
                    BroadcastReceiver.class, IntentFilter.class, int.class);
                m.invoke(activity, receiver, filter, Integer.valueOf(2));
                registered = true;
            } catch (Exception e) {
                Log.d(TAG, "flagged registerReceiver unavailable: " + e.getMessage());
            }
        }
        if (!registered) activity.registerReceiver(receiver, filter);

        listening = true;
        Log.d(TAG, "listening for " + action + " (key " + dataKey + ")");
        emitState();
    }

    private void unregisterReceiver() {
        if (!listening || receiver == null) { listening = false; return; }
        try {
            activity.unregisterReceiver(receiver);
        } catch (IllegalArgumentException ignored) {
            // already gone; nothing to undo
        }
        receiver = null;
        listening = false;
        emitState();
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;

        String raw = firstNonEmptyExtra(intent);
        if (raw == null) {
            // Some readers send a whole sweep as an array.
            String[] many = intent.getStringArrayExtra(dataKey);
            if (many != null) { for (String one : many) deliver(one, intent); return; }
            Log.d(TAG, "broadcast " + intent.getAction() + " carried no readable extra");
            return;
        }

        // The UHF app separates several tags with the configured interval
        // character, so one burst is not necessarily one tag.
        String[] parts = raw.split("[\\s,;\\r\\n\\u0000\\t]+");
        if (parts.length <= 1) deliver(raw, intent);
        else for (String p : parts) deliver(p, intent);
    }

    private String firstNonEmptyExtra(Intent intent) {
        String v = intent.getStringExtra(dataKey);
        if (v != null && v.trim().length() > 0) return v.trim();
        for (String k : EXTRA_KEYS) {
            v = intent.getStringExtra(k);
            if (v != null && v.trim().length() > 0) return v.trim();
        }
        byte[] bytes = intent.getByteArrayExtra("barocode");   // sic — Honeywell's spelling
        if (bytes != null && bytes.length > 0) return new String(bytes).trim();
        return null;
    }

    private void deliver(String rawCode, Intent intent) {
        if (rawCode == null) return;
        final String code = rawCode.trim();
        if (code.length() == 0) return;

        if (dedupeMs > 0) {
            if (recent.contains(code)) return;
            recent.add(code);
            main.postDelayed(new Runnable() {
                public void run() { recent.remove(code); }
            }, dedupeMs);
        }

        try {
            JSONObject o = new JSONObject();
            o.put("code", code);
            o.put("source", "broadcast");
            o.put("action", intent.getAction());
            o.put("at", System.currentTimeMillis());
            int rssi = intent.getIntExtra("rssi", intent.getIntExtra("RSSI", 0));
            if (rssi != 0) o.put("rssi", rssi);
            emit("tag", o);
        } catch (Exception e) {
            Log.w(TAG, "deliver: " + e.getMessage());
        }
    }

    private void sendBare(String bareAction) {
        Intent intent = new Intent(bareAction);
        intent.addFlags(Intent.FLAG_INCLUDE_STOPPED_PACKAGES);
        activity.sendBroadcast(intent);
        Log.d(TAG, "sent " + bareAction);
    }

    private void emitState() {
        try {
            JSONObject o = new JSONObject();
            o.put("listening", listening);
            o.put("scanning", scanning);
            emit("state", o);
        } catch (Exception ignored) { }
    }

    /**
     * Hand an event to the page.
     *
     * JSON both ways, so nothing has to be escaped by hand — the string is
     * parsed on the other side rather than interpolated into source.
     */
    private void emit(final String type, final JSONObject payload) {
        final String js = "window.__posRfidEvent && window.__posRfidEvent("
            + JSONObject.quote(type) + "," + JSONObject.quote(payload.toString()) + ")";
        main.post(new Runnable() {
            public void run() {
                try {
                    web.evaluateJavascript(js, null);
                } catch (Exception e) {
                    Log.w(TAG, "emit " + type + ": " + e.getMessage());
                }
            }
        });
    }

    private boolean isInstalled(String pkg) {
        try {
            activity.getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static String orDefault(String v, String fallback) {
        return (v == null || v.trim().length() == 0) ? fallback : v.trim();
    }

    void release() {
        unregisterReceiver();
    }
}
