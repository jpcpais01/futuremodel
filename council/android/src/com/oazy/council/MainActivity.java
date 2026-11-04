package com.oazy.council;

import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.widget.FrameLayout;
import android.view.WindowInsets;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/* Oazy Research for Android: the screens live in assets/www and read the two indexes from GitHub. */
public class MainActivity extends Activity {
  private WebView web;
  private FrameLayout root;

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
    // The page sits in a frame kept clear of the gesture bar, the keyboard and any camera cutout.
    // (A web view ignores its own padding, so the frame takes it.)
    root = new FrameLayout(this);
    root.setBackgroundColor(Color.rgb(4, 5, 11));
    root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
    root.setOnApplyWindowInsetsListener((View v, WindowInsets in) -> {
      if (Build.VERSION.SDK_INT >= 30) {
        android.graphics.Insets b = in.getInsets(WindowInsets.Type.navigationBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout());
        v.setPadding(b.left, b.top, b.right, b.bottom);
      } else {
        v.setPadding(in.getSystemWindowInsetLeft(), 0, in.getSystemWindowInsetRight(), in.getSystemWindowInsetBottom());
      }
      return in;
    });
    web.addJavascriptInterface(new Native(this), "Native");
    setContentView(root);
    hideStatusBar();
    // Android 13+ delivers the back gesture here (and only here when targeting Android 16).
    if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::back);
    web.loadUrl("file:///android_asset/www/index.html");
  }

  /* The app has its own header; the phone's status bar would only crowd it. A swipe from the top still shows it for a moment. */
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



  @Override public void onBackPressed() { back(); }

  private void back() {
    web.evaluateJavascript("window.ocBack ? String(window.ocBack()) : 'false'", (r) -> { if (!"\"true\"".equals(r)) moveTaskToBack(true); });
  }
}
