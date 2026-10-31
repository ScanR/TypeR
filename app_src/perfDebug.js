// Opt-in performance logger.
//
// Everything here is inert until it is switched on with `typerPerf.enable()`
// from the debug console. Once on it records:
//   - every ExtendScript round-trip (which host call, how long, how often)
//   - every reducer dispatch (action type + time spent in the reducer)
//   - every render of the instrumented React blocks
//   - click-to-paint latency and long frames (the actual "it lags" symptom)
//
// Read it with `typerPerf.report()`; `typerPerf.reset()` clears the counters.

// Node test scripts transpile and require app modules without a DOM, so every
// browser API here goes through this root instead of a bare `window`
const root = typeof window !== "undefined" ? window : null;

const STORAGE_KEY = "typerPerfDebug";
const LONG_FRAME_MS = 120;
const SLOW_CALL_MS = 40;

let enabled = false;
let frameLoopId = null;
let lastFrameAt = 0;
let pendingClickAt = 0;
let evalScriptPatched = false;
let originalEvalScript = null;

const stats = {
  host: new Map(),
  dispatch: new Map(),
  render: new Map(),
  clicks: [],
  longFrames: [],
};

const now = () =>
  root && root.performance && root.performance.now ? root.performance.now() : Date.now();

const readFlag = () => {
  try {
    return !!(root && root.localStorage && root.localStorage.getItem(STORAGE_KEY) === "1");
  } catch (e) {
    return false;
  }
};

const writeFlag = (value) => {
  try {
    if (!root || !root.localStorage) return;
    if (value) root.localStorage.setItem(STORAGE_KEY, "1");
    else root.localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    // Storage may be unavailable in some CEP builds; the flag stays session-only
  }
};

const bucket = (map, key) => {
  let entry = map.get(key);
  if (!entry) {
    entry = { key, count: 0, total: 0, max: 0 };
    map.set(key, entry);
  }
  return entry;
};

const record = (map, key, ms) => {
  const entry = bucket(map, key);
  entry.count++;
  entry.total += ms;
  if (ms > entry.max) entry.max = ms;
  return entry;
};

const isPerfDebugEnabled = () => enabled;

// --- ExtendScript round-trips ------------------------------------------------
// Patching the prototype catches every caller, including the ones that reach
// csInterface.evalScript directly instead of going through utils.js.
const patchEvalScript = () => {
  if (evalScriptPatched || !root || !root.CSInterface || !root.CSInterface.prototype) return;
  originalEvalScript = root.CSInterface.prototype.evalScript;
  evalScriptPatched = true;
  root.CSInterface.prototype.evalScript = function patchedEvalScript(script, callback) {
    if (!enabled) return originalEvalScript.call(this, script, callback);
    const label = String(script || "").split("(")[0] || "unknown";
    const startedAt = now();
    return originalEvalScript.call(this, script, (result) => {
      const ms = now() - startedAt;
      const entry = record(stats.host, label, ms);
      if (ms > SLOW_CALL_MS) {
        console.warn(`[typerPerf] slow host call ${label}: ${ms.toFixed(0)}ms (avg ${(entry.total / entry.count).toFixed(0)}ms over ${entry.count})`);
      }
      if (typeof callback === "function") callback(result);
    });
  };
};

// --- Frames & click latency --------------------------------------------------
const frameLoop = () => {
  const at = now();
  if (lastFrameAt) {
    const gap = at - lastFrameAt;
    if (gap > LONG_FRAME_MS) {
      stats.longFrames.push(Math.round(gap));
      if (stats.longFrames.length > 50) stats.longFrames.shift();
    }
  }
  lastFrameAt = at;
  if (pendingClickAt) {
    const latency = at - pendingClickAt;
    pendingClickAt = 0;
    stats.clicks.push(Math.round(latency));
    if (stats.clicks.length > 50) stats.clicks.shift();
    if (latency > LONG_FRAME_MS) {
      console.warn(`[typerPerf] click -> paint: ${latency.toFixed(0)}ms`);
    }
  }
  frameLoopId = root.requestAnimationFrame(frameLoop);
};

const handlePointerDown = () => {
  if (!enabled) return;
  pendingClickAt = now();
};

const startMonitors = () => {
  if (!root) return;
  patchEvalScript();
  root.addEventListener("pointerdown", handlePointerDown, true);
  lastFrameAt = 0;
  if (!frameLoopId) frameLoopId = root.requestAnimationFrame(frameLoop);
};

const stopMonitors = () => {
  if (!root) return;
  root.removeEventListener("pointerdown", handlePointerDown, true);
  if (frameLoopId) {
    root.cancelAnimationFrame(frameLoopId);
    frameLoopId = null;
  }
};

const setPerfDebugEnabled = (value) => {
  const next = !!value;
  if (next === enabled) return enabled;
  enabled = next;
  writeFlag(next);
  if (next) startMonitors();
  else stopMonitors();
  console.info(`[typerPerf] ${next ? "enabled" : "disabled"}`);
  return enabled;
};

// --- Instrumentation helpers (no-ops while disabled) -------------------------
const perfMeasure = (category, label, fn) => {
  if (!enabled) return fn();
  const startedAt = now();
  try {
    return fn();
  } finally {
    record(stats[category] || stats.dispatch, label, now() - startedAt);
  }
};

const notePerfRender = (label) => {
  if (!enabled) return;
  record(stats.render, label, 0);
};

const resetPerfDebug = () => {
  stats.host.clear();
  stats.dispatch.clear();
  stats.render.clear();
  stats.clicks.length = 0;
  stats.longFrames.length = 0;
};

const summarize = (map) =>
  Array.from(map.values())
    .sort((a, b) => b.total - a.total || b.count - a.count)
    .map((entry) => ({
      name: entry.key,
      calls: entry.count,
      totalMs: Math.round(entry.total),
      avgMs: Math.round((entry.total / entry.count) * 10) / 10,
      maxMs: Math.round(entry.max),
    }));

const average = (list) =>
  list.length ? Math.round(list.reduce((sum, value) => sum + value, 0) / list.length) : 0;

const reportPerfDebug = () => {
  const report = {
    hostCalls: summarize(stats.host),
    dispatches: summarize(stats.dispatch),
    renders: summarize(stats.render).map((entry) => ({ name: entry.name, renders: entry.calls })),
    clickToPaint: { samples: stats.clicks.length, avgMs: average(stats.clicks), worstMs: Math.max(0, ...stats.clicks) },
    longFrames: { count: stats.longFrames.length, worstMs: Math.max(0, ...stats.longFrames) },
  };
  if (console.table) {
    console.info("[typerPerf] ExtendScript round-trips (the usual cause of UI lag)");
    console.table(report.hostCalls);
    console.info("[typerPerf] reducer dispatches");
    console.table(report.dispatches);
    console.info("[typerPerf] renders");
    console.table(report.renders);
    console.info("[typerPerf] click -> paint", report.clickToPaint, "long frames", report.longFrames);
  } else {
    console.info("[typerPerf]", JSON.stringify(report, null, 2));
  }
  return report;
};

if (readFlag()) setPerfDebugEnabled(true);

if (root) {
  root.typerPerf = {
    enable: () => setPerfDebugEnabled(true),
    disable: () => setPerfDebugEnabled(false),
    isEnabled: isPerfDebugEnabled,
    report: reportPerfDebug,
    reset: resetPerfDebug,
  };
}

export {
  isPerfDebugEnabled,
  setPerfDebugEnabled,
  perfMeasure,
  notePerfRender,
  reportPerfDebug,
  resetPerfDebug,
};
