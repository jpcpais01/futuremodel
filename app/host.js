/* What the app needs from the device it runs on: the GitHub token box, links, window buttons, staying awake in a meeting.
   PC: window.oazyHost (desktop/preload.js). Phone: window.Native (android/src/.../Native.java). Otherwise a plain browser (tests). */
'use strict';
const HOST = (() => {
  const pc = window.oazyHost, an = window.Native;
  const ls = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
  if (pc) return {
    platform: 'pc', version: pc.version,
    getToken: () => pc.getToken(), setToken: (t) => pc.setToken(t),
    openUrl: (u) => pc.openUrl(u), keepAwake: (on) => pc.keepAwake(!!on),
    win: pc.win, onBeforeClose: pc.onBeforeClose,
  };
  if (an) return {
    platform: 'android', version: an.version(),
    getToken: async () => an.getToken() || null, setToken: async (t) => an.setToken(t || ''),
    openUrl: (u) => an.openUrl(u), keepAwake: (on) => an.keepAwake(!!on),
  };
  return {
    platform: 'web', version: '3.2.1',
    getToken: async () => ls.get('oz:token'), setToken: async (t) => ls.set('oz:token', t || null),
    openUrl: (u) => window.open(u, '_blank', 'noopener'), keepAwake: () => {},
  };
})();
