package ng.millzee.posrfid;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.KeyEvent;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

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
 *   com.seuic.uhftool.service.UhfService
 *     · broadcast action   com.android.server.scannerservice.broadcast
 *     · extra key          scannerdata          (the EPC, as a string)
 *     · extras             enter, append
 *     · start scanning     com.android.uhf.startscan
 *     · stop scanning      com.android.uhf.stopscan
 *
 * Those four strings are user-editable in the UHF app's settings (dev_broadcast,
 * dev_datakey, dev_start, dev_stop), so configure() below lets the POS override
 * them rather than hard-coding a shop into the defaults.
 *
 * ── What this fixes about the browser-only version ──────────────────────────
 *
 * In a plain browser the POS could only receive tags through the UHF app's
 * "Focus" send mode, which delivers text by calling a hidden
 * InputMethodManager.setCommitText(). That works, but it has three problems a
 * shop notices within an hour:
 *
 *   1. It types into whatever field happens to have focus. Tap the wrong box
 *      and a 24-character EPC lands in the customer's name.
 *   2. It sends no Enter key and no key events at all, so the page has to guess
 *      when a code has finished arriving by watching for a pause.
 *   3. The device ships on Broadcast mode, not Focus, so out of the box the
 *      browser receives nothing and it looks like the reader is broken.
 *
 * Listening for the broadcast directly removes all three. Tags arrive as data,
 * addressed to this app, whether or not anything is focused — and the POS can
 * finally start and stop the radio itself, which is what makes a hands-free
 * stock sweep possible instead of a trigger pull per tag.
 *
 * The keyboard-wedge path is kept as a fallback: if a shop has a different
 * handheld, or has reconfigured the UHF app, scans still reach the page the old
 * way. Both paths end at the same JS listener.
 */
@CapacitorPlugin(name = "Rfid")
public class RfidPlugin extends Plugin {

    private static final String TAG = "RfidPlugin";

    /** SEUIC defaults, confirmed against com.seuic.uhftool 1.6.22. */
    static final String DEFAULT_ACTION   = "com.android.server.scannerservice.broadcast";
    static final String DEFAULT_DATA_KEY = "scannerdata";
    static final String DEFAULT_START    = "com.android.uhf.startscan";
    static final String DEFAULT_STOP     = "com.android.uhf.stopscan";

    /**
     * Other vendors' handhelds use the same pattern with different strings.
     * Listening for all of them costs nothing and means a Chainway, a Zebra or
     * a Urovo works on day one instead of after a support call.
     */
    private static final String[] EXTRA_ACTIONS = {
        "com.rfid.SCAN",                                  // Chainway / generic
        "android.intent.ACTION_DECODE_DATA",              // Honeywell
        "com.symbol.datawedge.api.RESULT_ACTION",         // Zebra DataWedge
        "nlscan.action.SCANNER_RESULT",                   // Newland
        "com.ubx.scan.result",                            // Urovo
        "scan.rcv.message"                                // iData
    };

    /** Extras those vendors put the code in. First non-empty one wins. */
    private static final String[] EXTRA_KEYS = {
        DEFAULT_DATA_KEY, "data", "barcode", "EPC", "epc", "tagUii", "value",
        "barcode_string", "com.symbol.datawedge.data_string",
        "SCAN_BARCODE1", "decode_rslt", "scannerdata"
    };

    private String action  = DEFAULT_ACTION;
    private String dataKey = DEFAULT_DATA_KEY;
    private String startAction = DEFAULT_START;
    private String stopAction  = DEFAULT_STOP;

    private BroadcastReceiver receiver;
    private boolean listening = false;
    private boolean scanning  = false;

    /** Rolling de-duplication: the same tag re-reads many times a second. */
    private final Set<String> recent = new LinkedHashSet<>();
    private long recentWindowMs = 0;             // 0 = pass everything through
    private final Handler main = new Handler(Looper.getMainLooper());

    // ───────────────────────────────── lifecycle ─────────────────────────────

    @Override
    public void load() {
        // Deliberately not started here. The WebView registers when a screen
        // that wants tags mounts, so a handheld left on the dashboard is not
        // waking this app up for every tag that drifts past.
    }

    @Override
    protected void handleOnDestroy() {
        stopReceiver();
        super.handleOnDestroy();
    }

    @Override
    protected void handleOnPause() {
        // Keep the receiver registered: a stock sweep survives the screen
        // dimming, and Android will tear this down when the app really stops.
        super.handleOnPause();
    }

    // ───────────────────────────────── JS surface ────────────────────────────

    /** Is this running on hardware that can actually do any of this? */
    @PluginMethod
    public void available(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", true);
        ret.put("platform", "android");
        ret.put("model", Build.MODEL);
        ret.put("manufacturer", Build.MANUFACTURER);
        ret.put("device", Build.DEVICE);
        ret.put("androidSdk", Build.VERSION.SDK_INT);
        ret.put("listening", listening);
        ret.put("scanning", scanning);
        ret.put("action", action);
        ret.put("dataKey", dataKey);
        // Whether the SEUIC app is actually installed. If it is not, the
        // broadcast will never arrive however correct the filter is, and the
        // POS should say so rather than sit there looking ready.
        ret.put("uhfAppInstalled", isPackageInstalled("com.seuic.uhftool"));
        call.resolve(ret);
    }

    /**
     * Override the intent strings. A shop that has changed dev_broadcast or
     * dev_datakey in the UHF app's settings passes the new values here instead
     * of having to change them back.
     */
    @PluginMethod
    public void configure(PluginCall call) {
        action      = orDefault(call.getString("action"), DEFAULT_ACTION);
        dataKey     = orDefault(call.getString("dataKey"), DEFAULT_DATA_KEY);
        startAction = orDefault(call.getString("startAction"), DEFAULT_START);
        stopAction  = orDefault(call.getString("stopAction"), DEFAULT_STOP);
        if (call.getData().has("dedupeMs")) {
            recentWindowMs = call.getInt("dedupeMs", 0);
        }
        boolean was = listening;
        if (was) { stopReceiver(); startReceiver(); }
        JSObject ret = new JSObject();
        ret.put("action", action);
        ret.put("dataKey", dataKey);
        ret.put("listening", listening);
        call.resolve(ret);
    }

    /** Begin delivering tags to JS. Idempotent. */
    @PluginMethod
    public void startListening(PluginCall call) {
        startReceiver();
        JSObject ret = new JSObject();
        ret.put("listening", listening);
        call.resolve(ret);
    }

    @PluginMethod
    public void stopListening(PluginCall call) {
        stopReceiver();
        JSObject ret = new JSObject();
        ret.put("listening", listening);
        call.resolve(ret);
    }

    /**
     * Pull the trigger from software.
     *
     * This is the capability the browser build could never have. A stock take
     * over a thousand pairs of shoes is one tap here, not a thousand trigger
     * pulls — the radio runs continuously and tags stream in until stopScan().
     */
    @PluginMethod
    public void startScan(PluginCall call) {
        if (!listening) startReceiver();
        recent.clear();
        sendBare(startAction);
        scanning = true;
        notifyState();
        JSObject ret = new JSObject();
        ret.put("scanning", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void stopScan(PluginCall call) {
        sendBare(stopAction);
        scanning = false;
        notifyState();
        JSObject ret = new JSObject();
        ret.put("scanning", false);
        call.resolve(ret);
    }

    /**
     * Push a setting into the UHF app: transmit power, region, beep, vibrate.
     *
     * Region matters more than it looks. These handhelds ship configured for
     * FCC 902–928 MHz. In Nigeria the RAIN RFID allocation is 865.6–867.6 MHz
     * at 2 W ERP — the ETSI band — so a device straight out of the box is
     * transmitting on spectrum that is not the shop's to use, and reading badly
     * because the tags it is reading are tuned for the band it is not on.
     */
    @PluginMethod
    public void setReaderSetting(PluginCall call) {
        String key = call.getString("key");
        String value = call.getString("value");
        if (key == null || value == null) { call.reject("key and value are required"); return; }
        Intent intent = new Intent("com.seuic.uhftool.SETTINGS");
        intent.addFlags(Intent.FLAG_INCLUDE_STOPPED_PACKAGES);
        intent.putExtra("key", key);
        intent.putExtra("value", value);
        getContext().sendBroadcast(intent);
        call.resolve(new JSObject().put("sent", true).put("key", key).put("value", value));
    }

    /** Clear the de-duplication window — used between stock-take passes. */
    @PluginMethod
    public void resetDedupe(PluginCall call) {
        recent.clear();
        call.resolve();
    }

    // ─────────────────────────── hardware trigger keys ───────────────────────

    /**
     * The physical trigger and the side buttons arrive as key events. Passing
     * them to JS lets the POS use the trigger as "scan now" on screens where
     * the radio is not already sweeping, which is what people reach for.
     *
     * Note this only fires when the WebView has not consumed the event, which
     * is why captureInput is false in capacitor.config.json.
     */
    public boolean onHardwareKey(int keyCode, KeyEvent event, boolean down) {
        switch (keyCode) {
            case 280: case 281: case 282: case 283:   // SEUIC trigger / side keys
            case 293: case 294:
            case KeyEvent.KEYCODE_F5:
                JSObject payload = new JSObject();
                payload.put("keyCode", keyCode);
                payload.put("down", down);
                notifyListeners("triggerKey", payload);
                return true;
            default:
                return false;
        }
    }

    // ───────────────────────────────── internals ─────────────────────────────

    private void startReceiver() {
        if (listening) return;
        IntentFilter filter = new IntentFilter();
        filter.addAction(action);
        for (String a : EXTRA_ACTIONS) {
            if (!a.equals(action)) filter.addAction(a);
        }

        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                handleIntent(intent);
            }
        };

        // Android 13+ insists a runtime receiver declares whether it is willing
        // to hear from other apps. It very much is — the whole point is that
        // com.seuic.uhftool is the sender. ContextCompat picks the right call
        // for the running version, so this stays correct on Android 7 as well.
        ContextCompat.registerReceiver(getContext(), receiver, filter, ContextCompat.RECEIVER_EXPORTED);
        listening = true;
        Log.d(TAG, "listening for " + action + " (key " + dataKey + ")");
        notifyState();
    }

    private void stopReceiver() {
        if (!listening || receiver == null) { listening = false; return; }
        try {
            getContext().unregisterReceiver(receiver);
        } catch (IllegalArgumentException ignored) {
            // already gone; nothing to undo
        }
        receiver = null;
        listening = false;
        notifyState();
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        String raw = firstNonEmptyExtra(intent);
        if (raw == null) {
            // Some readers send an array of tags read in one sweep.
            String[] many = intent.getStringArrayExtra(dataKey);
            if (many != null) {
                for (String one : many) emit(one, intent);
                return;
            }
            Log.d(TAG, "broadcast " + intent.getAction() + " carried no readable extra");
            return;
        }

        // The UHF app separates multiple tags with the configured interval
        // character. Splitting on whitespace and the usual separators turns one
        // burst into the several tags it actually is.
        String[] parts = raw.split("[\\s,;\\r\\n\\u0000\\t]+");
        if (parts.length <= 1) {
            emit(raw, intent);
        } else {
            for (String p : parts) emit(p, intent);
        }
    }

    private String firstNonEmptyExtra(Intent intent) {
        String v = intent.getStringExtra(dataKey);
        if (v != null && !v.trim().isEmpty()) return v.trim();
        for (String k : EXTRA_KEYS) {
            v = intent.getStringExtra(k);
            if (v != null && !v.trim().isEmpty()) return v.trim();
        }
        byte[] bytes = intent.getByteArrayExtra("barocode");   // sic — Honeywell's spelling
        if (bytes != null && bytes.length > 0) return new String(bytes).trim();
        return null;
    }

    private void emit(String rawCode, Intent intent) {
        if (rawCode == null) return;
        final String code = rawCode.trim();
        if (code.isEmpty()) return;

        if (recentWindowMs > 0) {
            if (recent.contains(code)) return;
            recent.add(code);
            main.postDelayed(() -> recent.remove(code), recentWindowMs);
        }

        JSObject payload = new JSObject();
        payload.put("code", code);
        payload.put("source", "broadcast");
        payload.put("action", intent.getAction());
        payload.put("at", System.currentTimeMillis());
        int rssi = intent.getIntExtra("rssi", intent.getIntExtra("RSSI", 0));
        if (rssi != 0) payload.put("rssi", rssi);
        String count = intent.getStringExtra("count");
        if (count != null) payload.put("count", count);
        notifyListeners("tag", payload);
    }

    private void sendBare(String bareAction) {
        Intent intent = new Intent(bareAction);
        intent.addFlags(Intent.FLAG_INCLUDE_STOPPED_PACKAGES);
        getContext().sendBroadcast(intent);
        Log.d(TAG, "sent " + bareAction);
    }

    private void notifyState() {
        JSObject payload = new JSObject();
        payload.put("listening", listening);
        payload.put("scanning", scanning);
        notifyListeners("state", payload);
    }

    private boolean isPackageInstalled(String pkg) {
        try {
            getContext().getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static String orDefault(String v, String fallback) {
        return (v == null || v.trim().isEmpty()) ? fallback : v.trim();
    }
}
