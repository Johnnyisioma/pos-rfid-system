# The Android app (no-SDK build)

A working APK, built from the platform SDK alone. Run `./build.sh`.

## Why this exists alongside `android-app/`

`android-app/` is the Capacitor project — the one to open in Android Studio.
It is the better long-term home: plugins, updates, a normal Gradle build.

It also cannot be built without reaching `dl.google.com` and
`maven.google.com`, because the Android Gradle Plugin, the platform SDK,
androidx and Capacitor's own artifacts all live there. On a machine that
cannot reach those hosts, that project produces nothing at all.

This one has no such dependency. It compiles against the platform `android.jar`
with `javac`, dexes with `dx`, packages with `aapt` and signs with `apksigner`
— all of which Debian and Ubuntu ship:

```bash
apt install aapt dalvik-exchange apksigner zipalign \
            android-sdk-build-tools android-sdk-platform-23 default-jdk
./build.sh
```

Output: `build/pos-rfid.apk`, about 28 KB.

## What it is

A browser with one job and one extra power.

The job is to show the shop's POS. It loads your live site rather than bundling
a copy, which means **deploying to Railway updates every handheld at once** —
no rebuilding, no reinstalling, and no second copy of the app to go stale. The
page is served from the same origin it calls, so there is no CORS to configure
either.

The extra power is the radio. It hears `com.seuic.uhftool` directly and can
drive it:

| what | value | where the shop can change it |
|---|---|---|
| broadcast action | `com.android.server.scannerservice.broadcast` | UHF app → Settings → `dev_broadcast` |
| data extra | `scannerdata` | `dev_datakey` |
| start scanning | `com.android.uhf.startscan` | `dev_start` |
| stop scanning | `com.android.uhf.stopscan` | `dev_stop` |

All four can be overridden from the POS at runtime, so a shop that has changed
them does not have to change them back. Six other vendors' broadcast actions
(Chainway, Zebra DataWedge, Honeywell, Newland, Urovo, iData) are listened for
as well.

**Leave the UHF app on Broadcast** — its shipped default. Focus mode is not
needed any more, and Send Mode no longer matters.

## First launch

It asks for the shop's web address once — the same URL you use on a computer,
e.g. `your-shop.up.railway.app`, or `192.168.1.20:3000` on a shop network — and
remembers it. Change it later from Settings inside the POS, or from the
"Change the address" button on the can't-reach screen.

## Then check the reader

Open **RFID → Reader test** in the POS:

- it should name your handheld and say the UHF app is installed
- set **Region** to Nigeria / ETSI. These devices ship tuned for FCC
  902–928 MHz; Nigeria's RAIN RFID allocation is 865.6–867.6 MHz at 2 W ERP.
  On the wrong band the radio is both outside its licence and bad at reading,
  because the tags on the shelf are tuned for the band it is not using.
- turn **transmit power** down while tagging, or the reader will read a whole
  box of blank labels and bind the wrong one.

## Signing

`signing.keystore` is generated on the first build and kept out of `build/`, so
rebuilds reuse it. That matters: Android refuses to install an update signed by
a different key, and a keystore inside the wiped build directory would produce
a new identity every time.

It is a self-signed key. That is all a sideloaded app needs — it proves two
APKs came from the same build, nothing more. Replace it with your own before
anything goes near a store:

```bash
KEYSTORE=/path/to/yours.keystore STOREPASS=… ALIAS=… ./build.sh
```

## Choices worth knowing about

**`targetSdkVersion` is 24.** An app targeting 33 or above must declare
`RECEIVER_EXPORTED` when registering for another app's broadcast, and that
constant does not exist in the API 23 platform this compiles against.
Targeting 24 exempts the app from the requirement, and clears the floors
Android 14 and 15 put on installable apps (23 and 24). The code registers the
flagged receiver reflectively anyway, so bumping the target later will not
break it silently.

**Compiling against API 23 is not a limitation here.** Every API this app uses
— WebView, BroadcastReceiver, SharedPreferences, Vibrator — has been stable
since long before it. `minSdkVersion` is 21, so it runs on Android 5 upwards.

**The JS bridge is bound per page, not once.** `addJavascriptInterface` injects
into every frame a page loads, so a third-party iframe would get the same
object the POS uses to drive the radio. The bridge is attached only while the
WebView is on the shop's own origin, and links to anywhere else open in the
phone's browser instead.

**WebView debugging is left on.** Anyone with USB access to the handheld can
inspect the page — but anyone with the handheld in their hands can already use
the POS, which is already signed in, so this adds nothing to that risk and
makes a device you otherwise cannot diagnose supportable.

## Files

```
AndroidManifest.xml               permissions, target SDK, the launcher activity
src/ng/millzee/posrfid/
  MainActivity.java               the WebView, the server prompt, the trigger key
  RfidBridge.java                 the broadcast receiver and the JS bridge
res/                              icon and strings
build.sh                          the whole build, six steps, no Gradle
```

## Testing it without a device

```bash
npm run check:native     # from the repo root
```

Stands a fake bridge in front of the app — same method names and event shapes
the Java side sends — and drives the till, the stock take and the diagnostics
through it, **twice**: once shaped like this shell's JavascriptInterface and
once like the Capacitor plugin, because testing one is how the other quietly
stops working.

It cannot prove the Java compiles or that `com.seuic.uhftool` answers. Only
your handheld can.
