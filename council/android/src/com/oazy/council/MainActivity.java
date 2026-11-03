package com.oazy.council;

import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/* A thin shell around the Oazy Council phone screens, which live in assets/www. */
public class MainActivity extends Activity {
  private WebView web;

  @Override protected void onCreate(Bundle state) {
    super.onCreate(state);
    web = new WebView(this);
    web.setBackgroundColor(Color.rgb(6, 7, 12));
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setAllowFileAccess(true);
    s.setAllowFileAccessFromFileURLs(false);
    s.setAllowUniversalAccessFromFileURLs(false);
    s.setMediaPlaybackRequiresUserGesture(true);
    web.setWebViewClient(new WebViewClient() {
      // The app never navigates away from its own screens.
      @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return !r.getUrl().toString().startsWith("file:///android_asset/"); }
    });
    // Keep the page clear of the status and navigation bars.
    web.setOnApplyWindowInsetsListener((View v, WindowInsets in) -> {
      if (Build.VERSION.SDK_INT >= 30) {
        android.graphics.Insets b = in.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
        v.setPadding(b.left, b.top, b.right, b.bottom);
      } else {
        v.setPadding(in.getSystemWindowInsetLeft(), in.getSystemWindowInsetTop(), in.getSystemWindowInsetRight(), in.getSystemWindowInsetBottom());
      }
      return in;
    });
    setContentView(web);
    // Android 13+ delivers the back gesture here (and only here when targeting Android 16).
    if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::back);
    if (state != null) web.restoreState(state);
    else web.loadUrl("file:///android_asset/www/index.html");
  }

  @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

  @Override public void onBackPressed() { back(); }

  private void back() {
    web.evaluateJavascript("window.ocBack ? String(window.ocBack()) : 'false'", (r) -> { if (!"\"true\"".equals(r)) moveTaskToBack(true); });
  }
}
