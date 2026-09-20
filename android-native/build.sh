#!/usr/bin/env bash
#
# Build the APK with nothing but the platform SDK.
#
# No Gradle, no Capacitor, no androidx, no Maven. Every one of those is fetched
# from Google's mirrors at build time, and this has to work on a machine that
# cannot reach them. What it needs instead is in Debian and Ubuntu:
#
#   apt install aapt dalvik-exchange apksigner zipalign \
#               android-sdk-build-tools android-sdk-platform-23
#
# Compiling against API 23 is not a limitation here: every API this app uses —
# WebView, BroadcastReceiver, SharedPreferences, Vibrator — has been stable
# since long before it. The manifest targets 24, which is what decides runtime
# behaviour, and the app runs on everything from Android 5 upwards.
set -euo pipefail

cd "$(dirname "$0")"

ANDROID_JAR="${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}"
OUT="${OUT:-build}"
NAME="pos-rfid"
# Outside $OUT on purpose: the build directory is wiped on every run, and a
# keystore that changes each build produces APKs Android refuses to install
# over one another ("App not installed"). This file is the app's identity.
KEYSTORE="${KEYSTORE:-signing.keystore}"
STOREPASS="${STOREPASS:-posrfid}"
ALIAS="${ALIAS:-posrfid}"

[ -f "$ANDROID_JAR" ] || { echo "No android.jar at $ANDROID_JAR — install android-sdk-platform-23"; exit 1; }
for t in aapt zipalign apksigner dalvik-exchange javac keytool; do
  command -v "$t" >/dev/null || { echo "Missing $t"; exit 1; }
done

rm -rf "$OUT"
mkdir -p "$OUT/classes" "$OUT/gen"

echo "[1/6] resources"
# aapt generates R.java from res/, and writes the resource table into the apk.
aapt package -f -m \
  -J "$OUT/gen" \
  -M AndroidManifest.xml \
  -S res \
  -I "$ANDROID_JAR" \
  -F "$OUT/$NAME.unaligned.apk"

echo "[2/6] compile"
# --release 8 on purpose: dx reads Java 8 bytecode and rejects anything newer,
# and a JDK 17 or 21 would otherwise emit class files it cannot dex.
javac -nowarn -Xlint:-options \
  --release 8 \
  -classpath "$ANDROID_JAR" \
  -d "$OUT/classes" \
  $(find src "$OUT/gen" -name '*.java')

echo "[3/6] dex"
dalvik-exchange --dex --output="$OUT/classes.dex" "$OUT/classes"

echo "[4/6] package"
( cd "$OUT" && aapt add -k "$NAME.unaligned.apk" classes.dex >/dev/null )

echo "[5/6] sign"
if [ ! -f "$KEYSTORE" ]; then
  # A self-signed key, generated here. It proves that two APKs came from the
  # same build, which is all Android asks of a sideloaded app — it is not a
  # Play Store identity. Keep the file: Android refuses to install an update
  # signed by a different key, so losing it means uninstalling first.
  keytool -genkeypair -v \
    -keystore "$KEYSTORE" -storepass "$STOREPASS" -keypass "$STOREPASS" \
    -alias "$ALIAS" -keyalg RSA -keysize 2048 -validity 10950 \
    -dname "CN=POS RFID, OU=Retail, O=Millzee, L=Lagos, C=NG" 2>/dev/null
  echo "      generated $KEYSTORE (password: $STOREPASS)"
fi

# zipalign BEFORE signing: aligning afterwards would break the signature.
zipalign -f -p 4 "$OUT/$NAME.unaligned.apk" "$OUT/$NAME.aligned.apk"

apksigner sign \
  --ks "$KEYSTORE" --ks-pass "pass:$STOREPASS" --key-pass "pass:$STOREPASS" \
  --ks-key-alias "$ALIAS" \
  --v1-signing-enabled true --v2-signing-enabled true \
  --out "$OUT/$NAME.apk" \
  "$OUT/$NAME.aligned.apk"

echo "[6/6] verify"
apksigner verify --print-certs "$OUT/$NAME.apk" | head -4
aapt dump badging "$OUT/$NAME.apk" | grep -E "^package|sdkVersion|targetSdkVersion|application-label:|launchable-activity" || true

rm -f "$OUT/$NAME.unaligned.apk" "$OUT/$NAME.aligned.apk"
echo
echo "APK: $OUT/$NAME.apk  ($(du -h "$OUT/$NAME.apk" | cut -f1))"
