// What the engine reads from Node's `process`, on the phone.
export const process = { env: {}, pid: 1, platform: 'android', argv: [], versions: {}, nextTick: (fn, ...a) => Promise.resolve().then(() => fn(...a)) };
