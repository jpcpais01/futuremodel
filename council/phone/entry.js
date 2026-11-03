// The council engine for the phone: the same core the PC app runs, on the phone's own storage and network.
import { host } from './host.js';
const store = require('../engine/store');
store.setRoot('/data');
const { createCore } = require('../engine/core');

window.OazyCore = {
  native: host.native,
  llm: require('../engine/llm'),   // for the self-test
  create({ onEvents, onChanged }) {
    return createCore({
      platform: 'android', version: '1.1.0', deviceName: host.deviceName(),
      secrets: { get: (k) => host.secretGet(k), set: (k, v) => host.secretSet(k, v) },
      onEvents, onChanged,
      keepAlive: (on, text) => host.keepAlive(on, text),
      notify: (t, b) => { if (document.hidden) host.notify(t, b); },
    });
  },
};
