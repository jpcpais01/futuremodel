package com.oazy.council;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/* Oazy Research for Android. The app in assets/www is served from https://app.oazy.local/ so it is a secure page with
   its own storage. It does everything itself (GitHub, the council, the AI). This activity only gives it what a
   browser cannot: reading free data sources that send no CORS headers, and the SEC's contact header. */
public class MainActivity extends Activity {
  static final String ORIGIN_HOST = "app.oazy.local";
  static final String SEC_UA = "OazyResearch/3.0 (personal research) 158115534+jpcpais01@users.noreply.github.com";
  static final Pattern DATA_HOSTS = Pattern.compile("(^|\\.)(finance\\.yahoo\\.com|sec\\.gov|news\\.google\\.com|stlouisfed\\.org|cboe\\.com|gdeltproject\\.org|nasdaq\\.com|federalreserve\\.gov)$", Pattern.CASE_INSENSITIVE);
  private WebView web;
  private FrameLayout root;

  @Override protected void onCreate(Bundle state) {
    super.onCreate(state);
    web = new WebView(this);
    web.setBackgroundColor(Color.rgb(7, 8, 13));
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setAllowFileAccess(false);
    s.setAllowContentAccess(false);
    s.setMediaPlaybackRequiresUserGesture(true);
    web.setWebViewClient(new WebViewClient() {
      @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
        Uri u = r.getUrl();
        if (ORIGIN_HOST.equals(u.getHost())) return false;
        if ("https".equals(u.getScheme())) new Native(MainActivity.this).openUrl(u.toString());
        return true;
      }
      @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
        Uri u = r.getUrl(); String host = u.getHost() == null ? "" : u.getHost();
        if (ORIGIN_HOST.equals(host)) return asset(u.getPath());
        if ("https".equals(u.getScheme()) && DATA_HOSTS.matcher(host).find()) {
          if ("OPTIONS".equals(r.getMethod())) return cors(new WebResourceResponse("text/plain", "utf-8", 204, "No Content", new HashMap<>(), new ByteArrayInputStream(new byte[0])));
          if ("GET".equals(r.getMethod())) return fetch(u.toString(), r.getRequestHeaders(), host);
        }
        return null;
      }
    });
    // The page sits in a frame kept clear of the gesture bar, the keyboard and any camera cutout.
    root = new FrameLayout(this);
    root.setBackgroundColor(Color.rgb(7, 8, 13));
    root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
    root.setOnApplyWindowInsetsListener((View vv, WindowInsets in) -> {
      if (Build.VERSION.SDK_INT >= 30) {
        android.graphics.Insets b = in.getInsets(WindowInsets.Type.navigationBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout());
        vv.setPadding(b.left, b.top, b.right, b.bottom);
      } else {
        vv.setPadding(in.getSystemWindowInsetLeft(), 0, in.getSystemWindowInsetRight(), in.getSystemWindowInsetBottom());
      }
      return in;
    });
    web.addJavascriptInterface(new Native(this), "Native");
    setContentView(root);
    hideStatusBar();
    if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::back);
    web.loadUrl("https://" + ORIGIN_HOST + "/index.html");
  }

  /* The app's own files. */
  private WebResourceResponse asset(String path) {
    if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
    if (path.contains("..")) return notFound();
    try {
      InputStream in = getAssets().open("www" + path);
      Map<String, String> h = new HashMap<>(); h.put("Cache-Control", "no-cache");
      return new WebResourceResponse(mime(path), mime(path).startsWith("text/") || path.endsWith(".js") ? "utf-8" : null, 200, "OK", h, in);
    } catch (Exception e) { return notFound(); }
  }
  private static String mime(String p) {
    if (p.endsWith(".html")) return "text/html"; if (p.endsWith(".js")) return "text/javascript"; if (p.endsWith(".css")) return "text/css";
    if (p.endsWith(".png")) return "image/png"; if (p.endsWith(".webp")) return "image/webp"; if (p.endsWith(".svg")) return "image/svg+xml";
    if (p.endsWith(".woff2")) return "font/woff2"; if (p.endsWith(".json")) return "application/json"; return "application/octet-stream";
  }
  private static WebResourceResponse notFound() { return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<>(), new ByteArrayInputStream(new byte[0])); }

  /* A free data source, read by the phone and handed to the page with the CORS header it does not send. */
  private WebResourceResponse fetch(String url, Map<String, String> reqHeaders, String host) {
    HttpURLConnection c = null;
    try {
      c = (HttpURLConnection) new URL(url).openConnection();
      c.setConnectTimeout(20000); c.setReadTimeout(30000); c.setInstanceFollowRedirects(true);
      for (Map.Entry<String, String> e : reqHeaders.entrySet()) {
        String k = e.getKey().toLowerCase();
        if (k.equals("origin") || k.equals("referer") || k.equals("user-agent") || k.startsWith("sec-")) continue;
        c.setRequestProperty(e.getKey(), e.getValue());
      }
      c.setRequestProperty("User-Agent", host.toLowerCase().endsWith("sec.gov") ? SEC_UA : "Mozilla/5.0 (Linux; Android) OazyResearch/3.0");
      int code = c.getResponseCode();
      InputStream body = code >= 400 ? c.getErrorStream() : c.getInputStream();
      if (body == null) body = new ByteArrayInputStream(new byte[0]);
      String type = c.getContentType() == null ? "application/octet-stream" : c.getContentType();
      String mimeT = type.split(";")[0].trim(), cs = null;
      for (String part : type.split(";")) { part = part.trim(); if (part.toLowerCase().startsWith("charset=")) cs = part.substring(8); }
      Map<String, String> h = new HashMap<>();
      for (Map.Entry<String, List<String>> e : c.getHeaderFields().entrySet()) {
        if (e.getKey() == null) continue; String k = e.getKey().toLowerCase();
        if (k.startsWith("access-control-") || k.equals("content-encoding") || k.equals("content-length") || k.equals("transfer-encoding") || k.equals("set-cookie")) continue;
        h.put(e.getKey(), String.join(", ", e.getValue()));
      }
      String reason = c.getResponseMessage(); if (reason == null || reason.isEmpty()) reason = code < 400 ? "OK" : "Error";
      return cors(new WebResourceResponse(mimeT, cs, code, reason, h, body));
    } catch (Exception e) {
      return cors(new WebResourceResponse("text/plain", "utf-8", 502, "Bad Gateway", new HashMap<>(), new ByteArrayInputStream(new byte[0])));
    }
  }
  private static WebResourceResponse cors(WebResourceResponse r) {
    Map<String, String> h = r.getResponseHeaders() == null ? new HashMap<>() : new HashMap<>(r.getResponseHeaders());
    h.put("Access-Control-Allow-Origin", "*"); h.put("Access-Control-Allow-Headers", "*"); h.put("Access-Control-Allow-Methods", "GET, OPTIONS");
    r.setResponseHeaders(h); return r;
  }

  /* The app has its own header; the phone's status bar would only crowd it. A swipe from the top still shows it. */
  @SuppressWarnings("deprecation")
  private void hideStatusBar() {
    if (Build.VERSION.SDK_INT >= 30) {
      android.view.WindowInsetsController c = getWindow().getInsetsController();
      if (c != null) { c.hide(WindowInsets.Type.statusBars()); c.setSystemBarsBehavior(android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE); }
    } else {
      getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }
  }
  @Override public void onWindowFocusChanged(boolean focus) { super.onWindowFocusChanged(focus); if (focus) hideStatusBar(); }

  @SuppressWarnings("deprecation")
  @Override public void onBackPressed() { back(); }
  private void back() {
    web.evaluateJavascript("window.ozBack ? String(window.ozBack()) : 'false'", (r) -> { if (!"\"true\"".equals(r)) moveTaskToBack(true); });
  }
}
