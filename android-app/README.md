# The Android app

This turns the POS into an installable app for the handheld, and — more to the
point — gives it a direct line to the UHF radio.

## Why the app exists at all

In a browser, the reader can only reach the POS by pretending to be a keyboard.
The UHF app's "Focus" mode does that through a hidden
`InputMethodManager.setCommitText` call, and it has three problems a shop
notices within an hour:

1. It types into whatever field has focus. Tap the wrong box and a
   24-character EPC lands in the customer's name.
2. It sends no Enter and no key events at all, so the page has to guess when a
   code has finished arriving by watching for a pause.
3. **The device ships on Broadcast mode, not Focus.** Out of the box the
   browser receives nothing, and it looks like the reader is broken.

The app listens for the broadcast directly, which removes all three — and lets
the POS **start and stop the radio itself**. That is the difference between
holding the trigger down for an hour during a stock take and putting the
handheld in a trolley and walking the aisles.

## What it talks to

Decompiled from `com.seuic.uhftool` v1.6.22, the app that came with the device:

| what | value | where the shop can change it |
|---|---|---|
| broadcast action | `com.android.server.scannerservice.broadcast` | UHF app → Settings → `dev_broadcast` |
| data extra | `scannerdata` | `dev_datakey` |
| start scanning | `com.android.uhf.startscan` | `dev_start` |
| stop scanning | `com.android.uhf.stopscan` | `dev_stop` |

All four are overridable at runtime from the POS, so a shop that has changed
them does not have to change them back. Six other vendors' broadcast actions
(Chainway, Zebra DataWedge, Honeywell, Newland, Urovo, iData) are listened for
as well, so a different handheld works on day one rather than after a support
call.

## Building the APK

You need Android Studio, or a JDK plus the Android SDK (platform 36 and
build-tools). Then:

```bash
cd android-app
npm install
npm run apk          # builds the web app, syncs it, and assembles a debug APK
```

The APK lands at
`android-app/android/app/build/outputs/apk/debug/app-debug.apk`.
Copy it to the handheld and install it.

For a store-signable build, put your keystore details in
`android/app/build.gradle` under a `signingConfigs` block and run
`npm run apk:release`.

To open it in Android Studio instead:

```bash
npm run sync && npm run open
```

### On first launch

The app asks for the shop's web address once — the same URL you use on a
computer, e.g. `your-shop.up.railway.app`, or `192.168.1.20:3000` on a shop
network. It refuses to save an address until `/api/health` has answered from
it, because an app that accepts a typo and then fails on every screen is worse
than one that says so while you are still standing there.

Change it later under Settings → Device.

### On the handheld

Leave the UHF app on **Broadcast** — its shipped default. The POS app hears it
directly, so Focus mode is no longer needed and Send Mode does not matter.

Then open **RFID → Reader test** in the POS and check:

- it names your device and says the UHF app is installed
- **Region** is set to Nigeria / ETSI. These handhelds ship tuned for FCC
  902–928 MHz; Nigeria's RAIN RFID allocation is 865.6–867.6 MHz at 2 W ERP.
  On the wrong band the radio is both outside its licence and bad at reading,
  because the tags on the shelf are tuned for the band it is not using.
- **Transmit power** — turn it down while tagging, or the reader will happily
  read a whole box of blank labels and bind the wrong one.

## What is in here

```
capacitor.config.json          app id, name, and the WebView settings
scripts/stage-web.mjs          builds the client with POS_TARGET=android
android/app/src/main/java/ng/millzee/posrfid/
  MainActivity.java            registers the plugin, routes the trigger key
  RfidPlugin.java              the broadcast receiver and the JS bridge
```

Nothing else in `android/` is hand-written — Capacitor generates it, and
`npm run sync` regenerates what it owns.

## Testing it without a device

```bash
npm run check:native     # from the repo root
```

That stands a fake Capacitor plugin in front of the app — same method names,
same event shapes the Java side sends — and drives the till, the stock take
and the diagnostics through it. It cannot prove the Java compiles or that
`com.seuic.uhftool` answers; only a device can. It proves everything on this
side of the bridge.
