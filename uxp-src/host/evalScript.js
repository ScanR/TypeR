// The panel calls the host with ExtendScript strings, "name(json, json, ...)":
// csInterface.evalScript("setActiveLayerText(" + JSON.stringify(data) + ")").
// They are parsed, never evaluated.

// A missing optional argument reaches ExtendScript as a bare `undefined`,
// which JSON does not know: it becomes null, strings are left alone
function replaceBareUndefined(text) {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    if (inString) {
      out += char;
      if (char === "\\") {
        out += text.charAt(i + 1);
        i++;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (text.startsWith("undefined", i) && !/[\w$]/.test(text.charAt(i - 1) || "") && !/[\w$]/.test(text.charAt(i + 9) || "")) {
      out += "null";
      i += 8;
      continue;
    }
    out += char;
  }
  return out;
}

function parseCall(script) {
  const match = /^\s*([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)\s*;?\s*$/.exec(String(script || ""));
  if (!match) return null;
  const body = match[2].trim();
  if (!body) return { name: match[1], args: [] };
  try {
    return { name: match[1], args: JSON.parse("[" + body + "]") };
  } catch (error) {
    try {
      return { name: match[1], args: JSON.parse("[" + replaceBareUndefined(body) + "]") };
    } catch (secondError) {
      return null;
    }
  }
}

// Time limits of the host calls: past it, a call that never settled answers
// and the next one runs. Dialogs wait for the user and have none; calls that
// open documents, walk every layer (auto-centre, apply to many layers) or
// list the fonts get a longer one: a timed-out call Photoshop still finishes
// would be retried by the user and applied twice.
const CALL_TIMEOUT_MS = 60 * 1000;
const LONG_CALL_TIMEOUT_MS = 10 * 60 * 1000;
const CALL_TIMEOUTS = {
  nativeAlert: 0,
  nativeConfirm: 0,
  getUserFonts: LONG_CALL_TIMEOUT_MS,
  reloadUserFonts: LONG_CALL_TIMEOUT_MS,
  getAllRenderedTextLines: LONG_CALL_TIMEOUT_MS,
  scanTextShapeRTraining: LONG_CALL_TIMEOUT_MS,
  createTextLayerInSelection: LONG_CALL_TIMEOUT_MS,
  createTextLayersInStoredSelections: LONG_CALL_TIMEOUT_MS,
  setSelectedTextLayers: LONG_CALL_TIMEOUT_MS,
  alignTextLayersToDoubleBubble: LONG_CALL_TIMEOUT_MS,
  openFile: LONG_CALL_TIMEOUT_MS,
  scanPsdFonts: LONG_CALL_TIMEOUT_MS,
};

function callTimeout(script) {
  const match = /^\s*([A-Za-z_$][\w$]*)\s*\(/.exec(String(script || ""));
  const name = match ? match[1] : "";
  return Object.prototype.hasOwnProperty.call(CALL_TIMEOUTS, name) ? CALL_TIMEOUTS[name] : CALL_TIMEOUT_MS;
}

// Host calls run one at a time, as ExtendScript ran one script at a time:
// two calls could otherwise interleave their Photoshop commands. A call that
// never settles must not block every later one: past `timeoutMs` (0: no
// limit) the call answers onTimeout() and the next one starts. Nothing can
// cancel the late call; its result is dropped.
function createCallQueue({ schedule = setTimeout, cancel = clearTimeout } = {}) {
  let tail = Promise.resolve();
  return function enqueue(task, timeoutMs = 0, onTimeout = () => undefined) {
    const run = tail.then(() => {
      const work = Promise.resolve().then(task);
      if (!(timeoutMs > 0)) return work;
      let timer = null;
      const limit = new Promise((resolve) => {
        timer = schedule(() => resolve(onTimeout()), timeoutMs);
      });
      return Promise.race([work, limit]).finally(() => cancel(timer));
    });
    tail = run.catch(() => {});
    return run;
  };
}

module.exports = { parseCall, callTimeout, createCallQueue, CALL_TIMEOUT_MS, LONG_CALL_TIMEOUT_MS };
