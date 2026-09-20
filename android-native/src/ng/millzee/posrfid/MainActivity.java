package ng.millzee.posrfid;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

/**
 * The POS, running as an app on the handheld.
 *
 * It is a browser with one job and one extra power. The job is to show the
 * shop's POS; the power is that it can hear the UHF radio and drive it, which
 * a browser cannot.
 *
 * ── Why it loads the live site rather than bundling the web app ─────────────
 *
 * Bundling would mean rebuilding and reinstalling the APK on every handheld
 * each time the POS changes. Loading the shop's own URL means a deploy updates
 * every device at once, and the page is served from the same origin it calls,
 * so there is no CORS and no second copy of the app to go stale. The trade is
 * that the handheld needs a connection to start — which it needs anyway, since
 * the stock and the prices live on the server.
 */
public class MainActivity extends Activity {

    static final String VERSION = "5.0.0";

    private static final String PREFS = "pos";
    private static final String KEY_URL = "serverUrl";

    private WebView web;
    private RfidBridge rfid;
    private LinearLayout root;
    private boolean bridgeBound = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#0f172a"));
        setContentView(root, new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        web = new WebView(this);
        web.setLayoutParams(new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        root.addView(web);

        tuneWebView();

        rfid = new RfidBridge(this, web);
        // Bound per page in onPageStarted, not once here — see bindBridge().
        // The name the page looks for is deliberately not "Capacitor": the
        // page treats a Capacitor build and this shell differently, because
        // one serves its own assets and the other does not.

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                bindBridge(url);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                // Tell the page the bridge is here, after its own scripts have
                // had a chance to define the receiver.
                view.evaluateJavascript(
                    "window.dispatchEvent(new Event('posrfidready'))", null);
                rfid.startListening();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                // Keep the POS in the app; send anything else (a wa.me receipt
                // link, a tel: number) to the phone's own apps.
                if (url.startsWith(readServerUrl(MainActivity.this))) return false;
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    try {
                        startActivity(new android.content.Intent(
                            android.content.Intent.ACTION_VIEW, Uri.parse(url)));
                        return true;
                    } catch (Exception e) {
                        return false;
                    }
                }
                if (url.startsWith("tel:") || url.startsWith("sms:") || url.startsWith("mailto:")
                    || url.startsWith("whatsapp:")) {
                    try {
                        startActivity(new android.content.Intent(
                            android.content.Intent.ACTION_VIEW, Uri.parse(url)));
                        return true;
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this,
                            "Nothing on this device can open that", Toast.LENGTH_SHORT).show();
                        return true;
                    }
                }
                return false;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req != null && !req.isForMainFrame()) return;
                showUnreachable();
            }

            @Override
            @SuppressWarnings("deprecation")
            public void onReceivedError(WebView view, int code, String desc, String failingUrl) {
                showUnreachable();
            }
        });

        String url = readServerUrl(this);
        if (url == null || url.length() == 0) {
            promptForServer(false);
        } else {
            bindBridge(url);
            web.loadUrl(url);
        }
    }

    /**
     * Hand the bridge to the shop's own pages, and to nothing else.
     *
     * addJavascriptInterface injects into every frame a page loads, so a
     * third-party iframe would get the same object the POS uses to drive the
     * radio. Nothing the POS renders embeds one today — but "today" is a bad
     * thing to depend on when the fix is to bind the interface only while the
     * WebView is actually on the shop's origin.
     */
    private void bindBridge(String url) {
        String server = readServerUrl(this);
        boolean ours = server != null && server.length() > 0
            && url != null && url.startsWith(server);
        if (ours == bridgeBound) return;
        try {
            if (ours) web.addJavascriptInterface(rfid, "PosRfid");
            else web.removeJavascriptInterface("PosRfid");
            bridgeBound = ours;
        } catch (Exception e) {
            android.util.Log.w("PosRfid", "bindBridge: " + e.getMessage());
        }
    }

    private void tuneWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // the POS keeps its session here
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(false);           // laid out for this width already
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        // A shop's own server is often http:// on a LAN address. Without this
        // the WebView silently blocks every API call from an https page.
        if (Build.VERSION.SDK_INT >= 21) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
        if (Build.VERSION.SDK_INT >= 19) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
        web.setBackgroundColor(Color.WHITE);
    }

    /**
     * Ask for the shop's address.
     *
     * Asked once, on first launch, and reachable afterwards from the page. The
     * app cannot guess it — the POS could be on Railway, on a LAN box, or on
     * the shop's own domain.
     */
    void promptForServer(final boolean isChange) {
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        input.setHint("your-shop.up.railway.app");
        input.setSingleLine(true);
        String existing = readServerUrl(this);
        if (existing != null) input.setText(existing);

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (20 * getResources().getDisplayMetrics().density);
        box.setPadding(pad, pad / 2, pad, 0);

        TextView help = new TextView(this);
        help.setText("Type the web address you use for the POS on a computer. "
            + "You only do this once.");
        help.setTextSize(13);
        box.addView(help);
        box.addView(input);

        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("Connect to your shop")
            .setView(box)
            .setCancelable(isChange)
            .setPositiveButton("Connect", null)          // set below, so it can refuse to close
            .create();

        dialog.setOnShowListener(new DialogInterface.OnShowListener() {
            public void onShow(DialogInterface d) {
                Button ok = ((AlertDialog) d).getButton(AlertDialog.BUTTON_POSITIVE);
                ok.setOnClickListener(new View.OnClickListener() {
                    public void onClick(View v) {
                        String url = normalize(input.getText().toString());
                        if (url == null) {
                            // Refusing a typo here beats failing on every
                            // screen afterwards, while the person is still
                            // standing there able to fix it.
                            input.setError("That does not look like a web address");
                            return;
                        }
                        writeServerUrl(MainActivity.this, url);
                        ((AlertDialog) d).dismiss();
                        web.clearCache(false);
                        bindBridge(url);
                        web.loadUrl(url);
                    }
                });
            }
        });
        dialog.show();
    }

    /** Turn whatever was typed into a usable origin, or null. */
    static String normalize(String raw) {
        if (raw == null) return null;
        String s = raw.trim();
        if (s.length() == 0) return null;
        if (!s.startsWith("http://") && !s.startsWith("https://")) s = "https://" + s;
        try {
            Uri u = Uri.parse(s);
            if (u.getHost() == null || u.getHost().indexOf('.') < 0) {
                // No dot means it is not a hostname — except a bare LAN IP
                // with a port, which Uri parses fine and does contain dots.
                return null;
            }
            String out = u.getScheme() + "://" + u.getHost();
            if (u.getPort() > 0) out += ":" + u.getPort();
            return out;
        } catch (Exception e) {
            return null;
        }
    }

    static String readServerUrl(Context c) {
        return c.getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_URL, "");
    }

    static void writeServerUrl(Context c, String url) {
        SharedPreferences.Editor e = c.getSharedPreferences(PREFS, MODE_PRIVATE).edit();
        e.putString(KEY_URL, url);
        e.apply();
    }

    /**
     * The server did not answer.
     *
     * "Web page not available" tells a shopkeeper nothing and leaves them
     * stuck, so this says what is wrong and offers the two things that fix it.
     */
    private void showUnreachable() {
        root.removeAllViews();

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        int pad = (int) (24 * getResources().getDisplayMetrics().density);
        box.setPadding(pad, pad, pad, pad);
        box.setLayoutParams(new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        TextView title = new TextView(this);
        title.setText("Cannot reach the shop");
        title.setTextColor(Color.WHITE);
        title.setTextSize(20);
        title.setGravity(Gravity.CENTER);

        TextView body = new TextView(this);
        body.setText("No answer from\n" + readServerUrl(this)
            + "\n\nCheck this handheld has internet, and that the address is right.");
        body.setTextColor(Color.parseColor("#94a3b8"));
        body.setTextSize(14);
        body.setGravity(Gravity.CENTER);
        body.setPadding(0, pad / 2, 0, pad);

        Button retry = new Button(this);
        retry.setText("Try again");
        retry.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { restoreWebView(); web.reload(); }
        });

        Button change = new Button(this);
        change.setText("Change the address");
        change.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { restoreWebView(); promptForServer(true); }
        });

        box.addView(title);
        box.addView(body);
        box.addView(retry);
        box.addView(change);
        root.addView(box);
    }

    private void restoreWebView() {
        root.removeAllViews();
        root.addView(web);
    }

    /**
     * The handheld's trigger is a key event, not a touch. Give the bridge
     * first refusal; anything it does not claim behaves normally, so volume
     * and Back still work.
     */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        // getRepeatCount() > 0 means the trigger is being HELD. Swallow the
        // repeats — one press is one intent, not forty.
        if (rfid != null && event.getRepeatCount() == 0 && rfid.onHardwareKey(keyCode, true)) {
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_BACK && web != null && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (rfid != null && rfid.onHardwareKey(keyCode, false)) return true;
        return super.onKeyUp(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        if (rfid != null) rfid.release();
        super.onDestroy();
    }
}
