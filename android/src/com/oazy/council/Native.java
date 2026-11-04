package com.oazy.council;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/* What the page may ask of the phone: the GitHub token (locked with a key that never leaves the phone's keystore),
   opening a link, keeping the screen on during a meeting, and the version. Nothing else. */
public class Native {
  private static final String ALIAS = "oazy-github-token";
  private final MainActivity act;
  Native(MainActivity act) { this.act = act; }

  @JavascriptInterface public String version() {
    try { return act.getPackageManager().getPackageInfo(act.getPackageName(), 0).versionName; } catch (Exception e) { return ""; }
  }

  @JavascriptInterface public void openUrl(String url) {
    if (url != null && url.startsWith("https://")) act.runOnUiThread(() -> { try { act.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) {} });
  }

  @JavascriptInterface public void setSecContact(String c) {
    if (c == null) return; String v = c.replaceAll("[^\\x20-\\x7e]", "").trim(); if (v.length() > 120) v = v.substring(0, 120);
    if (!v.isEmpty()) MainActivity.SEC_UA = "OazyResearch " + v;
  }

  @JavascriptInterface public void keepAwake(boolean on) {
    act.runOnUiThread(() -> { if (on) act.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); else act.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); });
  }

  private SharedPreferences prefs() { return act.getSharedPreferences("oazy", Context.MODE_PRIVATE); }
  private SecretKey key() throws Exception {
    KeyStore ks = KeyStore.getInstance("AndroidKeyStore"); ks.load(null);
    if (ks.containsAlias(ALIAS)) return ((KeyStore.SecretKeyEntry) ks.getEntry(ALIAS, null)).getSecretKey();
    KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
    g.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
    return g.generateKey();
  }

  @JavascriptInterface public String getToken() {
    try {
      String iv = prefs().getString("tokIv", null), ct = prefs().getString("tok", null);
      if (iv == null || ct == null) return "";
      Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
      c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
      return new String(c.doFinal(Base64.decode(ct, Base64.NO_WRAP)), StandardCharsets.UTF_8);
    } catch (Exception e) { return ""; }
  }

  @JavascriptInterface public boolean setToken(String t) {
    try {
      if (t == null || t.isEmpty()) { prefs().edit().remove("tok").remove("tokIv").apply(); return true; }
      Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
      c.init(Cipher.ENCRYPT_MODE, key());
      byte[] ct = c.doFinal(t.getBytes(StandardCharsets.UTF_8));
      prefs().edit().putString("tok", Base64.encodeToString(ct, Base64.NO_WRAP)).putString("tokIv", Base64.encodeToString(c.getIV(), Base64.NO_WRAP)).apply();
      return true;
    } catch (Exception e) { return false; }
  }
}
