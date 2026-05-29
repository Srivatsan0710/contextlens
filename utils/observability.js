window.ContextLens = window.ContextLens || {};

const _enabled = true;
const _timers = {};

window.ContextLens.logEvent = function (tag, data = {}) {
  if (!_enabled) return;
  console.log(`[ContextLens:${tag}]`, data);
};

window.ContextLens.logTimerStart = function (id) {
  _timers[id] = performance.now();
};

window.ContextLens.logTimerEnd = function (id, tag, extraData = {}) {
  const start = _timers[id];
  if (!start) return null;
  delete _timers[id];
  const latency = Math.round(performance.now() - start);
  window.ContextLens.logEvent(tag, { ...extraData, latency: `${latency}ms` });
  return latency;
};
