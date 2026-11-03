package com.oazy.council;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONArray;

/* What the council engine needs from the phone: private files, the network, the keystore, and staying awake during a session. */
public class Native {
  private final MainActivity act;
  private final WebView web;
  private final File root;
  private final ExecutorService pool = Executors.newCachedThreadPool();
  private final Map<Integer, HttpURLConnection> open = new ConcurrentHashMap<>();
  private final Map<Integer, Boolean> aborted = new ConcurrentHashMap<>();

  Native(MainActivity act, WebView web) {
    this.act = act; this.web = web;
    root = new File(act.getFilesDir(), "data"); root.mkdirs();
  }

  /* ── Files, all inside the app's private storage ── */
  private File f(String rel) {
    if (rel == null) rel = "";
    for (String p : rel.split("/")) if (p.equals("..")) throw new SecurityException("bad path");
    return rel.isEmpty() ? root : new File(root, rel);
  }
  private static byte[] readAll(InputStream in) throws Exception {
    ByteArrayOutputStream o = new ByteArrayOutputStream(); byte[] b = new byte[16384]; int n;
    while ((n = in.read(b)) > 0) o.write(b, 0, n); return o.toByteArray();
  }
  @JavascriptInterface public String fsRead(String rel) {
    try (InputStream in = new java.io.FileInputStream(f(rel))) { return new String(readAll(in), StandardCharsets.UTF_8); } catch (Exception e) { return null; }
  }
  private boolean write(String rel, String text, boolean append) {
    try { File t = f(rel); File d = t.getParentFile(); if (d != null) d.mkdirs();
      try (OutputStream o = new FileOutputStream(t, append)) { o.write(text.getBytes(StandardCharsets.UTF_8)); if (!append) ((FileOutputStream) o).getFD().sync(); }
      return true; } catch (Exception e) { return false; }
  }
  @JavascriptInterface public boolean fsWrite(String rel, String text) { return write(rel, text, false); }
  @JavascriptInterface public boolean fsAppend(String rel, String text) { return write(rel, text, true); }
  @JavascriptInterface public boolean fsRename(String a, String b) { try { File to = f(b); return f(a).renameTo(to); } catch (Exception e) { return false; } }
  @JavascriptInterface public boolean fsMkdirs(String rel) { try { File d = f(rel); return d.isDirectory() || d.mkdirs(); } catch (Exception e) { return false; } }
  @JavascriptInterface public String fsList(String rel) {
    try { String[] l = f(rel).list(); if (l == null) return null; JSONArray a = new JSONArray(); for (String s : l) a.put(s); return a.toString(); } catch (Exception e) { return null; }
  }
  @JavascriptInterface public double fsMtime(String rel) { try { File x = f(rel); return x.exists() ? x.lastModified() : -1; } catch (Exception e) { return -1; } }

  /* ── Network: the engine's fetch, streamed back to the page in pieces ── */
  private void js(String code) { web.post(() -> web.evaluateJavascript(code, null)); }
  private static String q(String s) { return org.json.JSONObject.quote(s == null ? "" : s); }

  @JavascriptInterface public void fetchStart(int id, String method, String url, String headersJson, String body) {
    pool.execute(() -> {
      HttpURLConnection c = null;
      try {
        c = (HttpURLConnection) new URL(url).openConnection();
        open.put(id, c);
        c.setRequestMethod(method);
        c.setConnectTimeout(30000); c.setReadTimeout(6 * 60000);
        c.setInstanceFollowRedirects(true);
        JSONArray h = new JSONArray(headersJson);
        for (int i = 0; i < h.length(); i++) {
          JSONArray kv = h.getJSONArray(i); String k = kv.getString(0);
          // The phone's network stack sets these itself (and unzips responses for us).
          if (k.equalsIgnoreCase("accept-encoding") || k.equalsIgnoreCase("content-length") || k.equalsIgnoreCase("host") || k.equalsIgnoreCase("connection")) continue;
          c.setRequestProperty(k, kv.getString(1));
        }
        if (body != null && !method.equals("GET") && !method.equals("HEAD")) {
          byte[] b = body.getBytes(StandardCharsets.UTF_8);
          c.setDoOutput(true); c.setFixedLengthStreamingMode(b.length);
          try (OutputStream o = c.getOutputStream()) { o.write(b); }
        }
        int status = c.getResponseCode();
        JSONArray hs = new JSONArray();
        for (Map.Entry<String, List<String>> e : c.getHeaderFields().entrySet()) {
          if (e.getKey() == null) continue;
          JSONArray kv = new JSONArray(); kv.put(e.getKey()); kv.put(String.join(", ", e.getValue())); hs.put(kv);
        }
        js("__ocNet.head(" + id + "," + status + "," + q(hs.toString()) + ")");
        InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
        if (in != null) {
          byte[] buf = new byte[16384]; int n;
          while ((n = in.read(buf)) > 0) {
            if (aborted.containsKey(id)) break;
            js("__ocNet.chunk(" + id + ",'" + Base64.encodeToString(buf, 0, n, Base64.NO_WRAP) + "')");
          }
          in.close();
        }
        js("__ocNet.end(" + id + ")");
      } catch (Exception e) {
        if (!aborted.containsKey(id)) js("__ocNet.error(" + id + "," + q(String.valueOf(e.getMessage())) + ")");
      } finally {
        open.remove(id); aborted.remove(id);
        if (c != null) c.disconnect();
      }
    });
  }
  @JavascriptInterface public void fetchAbort(int id) {
    aborted.put(id, true);
    HttpURLConnection c = open.get(id);
    if (c != null) pool.execute(c::disconnect);
  }

  /* ── Secrets: encrypted with a key that never leaves the phone's keystore ── */
  private static final String ALIAS = "oazy_council_secrets";
  private SecretKey key() throws Exception {
    KeyStore ks = KeyStore.getInstance("AndroidKeyStore"); ks.load(null);
    if (ks.containsAlias(ALIAS)) return ((KeyStore.SecretKeyEntry) ks.getEntry(ALIAS, null)).getSecretKey();
    KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
    g.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
    return g.generateKey();
  }
  private SharedPreferences prefs() { return act.getSharedPreferences("secrets", Context.MODE_PRIVATE); }
  @JavascriptInterface public String secretGet(String name) {
    try {
      String v = prefs().getString(name, null); if (v == null) return "";
      byte[] all = Base64.decode(v, Base64.NO_WRAP);
      Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
      c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, all, 0, 12));
      return new String(c.doFinal(all, 12, all.length - 12), StandardCharsets.UTF_8);
    } catch (Exception e) { return ""; }
  }
  @JavascriptInterface public boolean secretSet(String name, String value) {
    try {
      if (value == null || value.isEmpty()) { prefs().edit().remove(name).apply(); return true; }
      Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
      c.init(Cipher.ENCRYPT_MODE, key());
      byte[] iv = c.getIV(), ct = c.doFinal(value.getBytes(StandardCharsets.UTF_8)), all = new byte[iv.length + ct.length];
      System.arraycopy(iv, 0, all, 0, iv.length); System.arraycopy(ct, 0, all, iv.length, ct.length);
      prefs().edit().putString(name, Base64.encodeToString(all, Base64.NO_WRAP)).apply();
      return true;
    } catch (Exception e) { return false; }
  }

  /* ── Staying alive during a session, and telling the user when it ends ── */
  @JavascriptInterface public void keepAlive(boolean on, String text) {
    act.runOnUiThread(() -> act.keepScreenOn(on));
    Intent i = new Intent(act, CouncilService.class);
    if (on) { i.putExtra("text", text); if (Build.VERSION.SDK_INT >= 26) act.startForegroundService(i); else act.startService(i); }
    else act.stopService(i);
  }
  @JavascriptInterface public void notify(String title, String body) { CouncilService.notifyDone(act, title, body); }
  @JavascriptInterface public String deviceName() {
    String m = Build.MODEL == null ? "Android" : Build.MODEL;
    return "Phone (" + m + ")";
  }
  @JavascriptInterface public void openUrl(String url) {
    if (url != null && url.startsWith("https://")) act.runOnUiThread(() -> act.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))));
  }
}
