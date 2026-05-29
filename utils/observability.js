window.ReadIn = window.ReadIn || {};

const _enabled = true;
const _timers = {};

window.ReadIn.logEvent = function (tag, data = {}) {
  if (!_enabled) return;
  console.log(`[ReadIn:${tag}]`, data);
};

window.ReadIn.logTimerStart = function (id) {
  _timers[id] = performance.now();
};

window.ReadIn.logTimerEnd = function (id, tag, extraData = {}) {
  const start = _timers[id];
  if (!start) return null;
  delete _timers[id];
  const latency = Math.round(performance.now() - start);
  window.ReadIn.logEvent(tag, { ...extraData, latency: `${latency}ms` });
  return latency;
};
