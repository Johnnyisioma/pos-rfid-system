package ng.millzee.posrfid;

import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

/**
 * The POS, running as an app on the handheld.
 *
 * Three jobs beyond what Capacitor gives you for free:
 *
 *   1. Register RfidPlugin, so the WebView can hear the UHF radio.
 *   2. Route the physical trigger and side keys to that plugin, because a
 *      WebView does not receive them as anything JavaScript can use.
 *   3. Tell the reader which country it is in. These devices ship on FCC
 *      902–928 MHz; Nigeria's RAIN RFID allocation is 865.6–867.6 MHz at 2 W
 *      ERP. Left alone the handheld transmits outside its licence and reads
 *      badly, and the shop concludes RFID does not work.
 */
public class MainActivity extends BridgeActivity {

    private RfidPlugin rfid;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RfidPlugin.class);
        super.onCreate(savedInstanceState);
        tuneWebView();
    }

    @Override
    public void onStart() {
        super.onStart();
        if (rfid == null && getBridge() != null) {
            com.getcapacitor.PluginHandle handle = getBridge().getPlugin("Rfid");
            if (handle != null) rfid = (RfidPlugin) handle.getInstance();
        }
    }

    /**
     * The handheld's trigger is a key event, not a touch. Give the plugin first
     * refusal on it; anything it does not claim behaves normally, so the volume
     * keys and Back still work.
     */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        // getRepeatCount() > 0 means the trigger is being HELD. Swallow the
        // repeats — one press is one intent, not forty.
        if (rfid != null && event.getRepeatCount() == 0 && rfid.onHardwareKey(keyCode, event, true)) {
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (rfid != null && rfid.onHardwareKey(keyCode, event, false)) {
            return true;
        }
        return super.onKeyUp(keyCode, event);
    }

    private void tuneWebView() {
        if (getBridge() == null) return;
        WebView web = getBridge().getWebView();
        if (web == null) return;
        WebSettings s = web.getSettings();

        // A shop's own server is usually http:// on a LAN address. Without this
        // the WebView silently blocks every API call from an https page.
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        // Stock counts run for an hour with the screen on and thousands of rows
        // in the DOM. Keeping the cache to the network path only avoids serving
        // a stale inventory figure from disk after the device loses signal.
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        // The till and the stock-take screen are laid out for this width. Left
        // to itself the WebView applies a desktop viewport and everything is
        // half size on a 4-inch handheld.
        s.setUseWideViewPort(false);
        s.setLoadWithOverviewMode(false);
        s.setTextZoom(100);
    }
}
