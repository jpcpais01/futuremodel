package com.oazy.council;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/* Keeps the app running while the council is in session, so a locked screen does not cut a paid session short. */
public class CouncilService extends Service {
  private static final String CH_LIVE = "session", CH_DONE = "results";
  private PowerManager.WakeLock lock;

  static void channels(Context c) {
    if (Build.VERSION.SDK_INT < 26) return;
    NotificationManager nm = c.getSystemService(NotificationManager.class);
    nm.createNotificationChannel(new NotificationChannel(CH_LIVE, "Session in progress", NotificationManager.IMPORTANCE_LOW));
    nm.createNotificationChannel(new NotificationChannel(CH_DONE, "Council decisions", NotificationManager.IMPORTANCE_DEFAULT));
  }
  private static Notification.Builder builder(Context c, String ch) {
    Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, ch) : new Notification.Builder(c);
    Intent open = new Intent(c, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
    return b.setSmallIcon(R.drawable.ic_stat).setContentIntent(PendingIntent.getActivity(c, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
  }
  static void notifyDone(Context c, String title, String body) {
    try { channels(c); c.getSystemService(NotificationManager.class).notify(2, builder(c, CH_DONE).setContentTitle(title).setContentText(body).setStyle(new Notification.BigTextStyle().bigText(body)).setAutoCancel(true).build()); } catch (Exception ignored) {}
  }

  @Override public int onStartCommand(Intent i, int flags, int id) {
    channels(this);
    String text = i != null && i.getStringExtra("text") != null ? i.getStringExtra("text") : "The council is in session";
    Notification n = builder(this, CH_LIVE).setContentTitle("Oazy Council").setContentText(text).setOngoing(true).build();
    if (Build.VERSION.SDK_INT >= 29) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC); else startForeground(1, n);
    if (lock == null) { lock = getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "oazy:council"); lock.acquire(3 * 60 * 60 * 1000L); }
    return START_NOT_STICKY;
  }
  @Override public void onDestroy() { if (lock != null && lock.isHeld()) lock.release(); lock = null; super.onDestroy(); }
  @Override public IBinder onBind(Intent i) { return null; }
}
