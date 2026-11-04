package com.oazy.council;

import android.content.Intent;
import android.net.Uri;
import android.webkit.JavascriptInterface;

/* The one thing the page asks of the phone: open a link (GitHub) in the browser. Everything else is the page reading the repository. */
public class Native {
  private final MainActivity act;
  Native(MainActivity act) { this.act = act; }

  @JavascriptInterface public void openUrl(String url) {
    if (url != null && url.startsWith("https://")) act.runOnUiThread(() -> act.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))));
  }
}
