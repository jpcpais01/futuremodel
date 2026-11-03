#!/usr/bin/env bash
# Builds the Oazy Council APK with the plain Android SDK tools (no Gradle).
# Needs: ANDROID_HOME with build-tools and a platform, a JDK 17+.
# Signing key: $OC_KEYSTORE (created on first run if missing; keep it, or phones must reinstall to update).
set -euo pipefail
cd "$(dirname "$0")"
SDK=${ANDROID_HOME:?set ANDROID_HOME}
BT=$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)
PLAT=$(ls -d "$SDK"/platforms/android-* | sort -V | tail -1)/android.jar
KS=${OC_KEYSTORE:-$HOME/.oazy-council.keystore}
PASS=${OC_KEYPASS:-oazycouncil}
OUT=build; rm -rf $OUT; mkdir -p $OUT/assets/www $OUT/classes $OUT/compiled
node ../phone/build.js >/dev/null   # the council engine for the phone, into mobile/core.bundle.js
cp -r ../mobile/. $OUT/assets/www/
"$BT/aapt2" compile --dir res -o $OUT/compiled/res.zip
"$BT/aapt2" link -o $OUT/base.apk -I "$PLAT" --manifest AndroidManifest.xml -A $OUT/assets $OUT/compiled/res.zip --auto-add-overlay --java $OUT/gen
javac -source 11 -target 11 -nowarn -classpath "$PLAT" -d $OUT/classes src/com/oazy/council/*.java $(find $OUT/gen -name '*.java')
"$BT/d8" --min-api 24 --lib "$PLAT" --output $OUT $(find $OUT/classes -name '*.class')
(cd $OUT && zip -q base.apk classes.dex)
"$BT/zipalign" -f -p 4 $OUT/base.apk $OUT/aligned.apk
if [ ! -f "$KS" ]; then keytool -genkeypair -keystore "$KS" -storepass "$PASS" -keypass "$PASS" -alias council -keyalg RSA -keysize 3072 -validity 10000 -dname "CN=Oazy Council" >/dev/null; fi
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:"$PASS" --ks-key-alias council --out ../dist/OazyCouncil.apk $OUT/aligned.apk 2>/dev/null || { mkdir -p ../dist; "$BT/apksigner" sign --ks "$KS" --ks-pass pass:"$PASS" --ks-key-alias council --out ../dist/OazyCouncil.apk $OUT/aligned.apk; }
"$BT/apksigner" verify ../dist/OazyCouncil.apk && echo "Built dist/OazyCouncil.apk ($(du -h ../dist/OazyCouncil.apk | cut -f1))"
