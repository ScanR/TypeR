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

// Time limits of the host calls: past it, a call that has not settled
// answers as failed (the next call still waits for it, see createCallQueue).
// Dialogs wait for the user and have none; calls that open documents, walk
// every layer (auto-centre, apply to many layers) or list the fonts get a
// longer one; the smart paste gets the two minutes the panel waits for it.
const CALL_TIMEOUT_MS = 60 * 1000;
const SMART_PASTE_TIMEOUT_MS = 2 * 60 * 1000;
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
  smartPaste: SMART_PASTE_TIMEOUT_MS,
};

function callTimeout(script) {
  const match = /^\s*([A-Za-z_$][\w$]*)\s*\(/.exec(String(script || ""));
  const name = match ? match[1] : "";
  return Object.prototype.hasOwnProperty.call(CALL_TIMEOUTS, name) ? CALL_TIMEOUTS[name] : CALL_TIMEOUT_MS;
}

// Host calls run one at a time, as ExtendScript ran one script at a time:
// two calls would otherwise interleave their Photoshop commands. Past
// `timeoutMs` (0: no limit) a call answers onTimeout(started), but nothing
// can cancel it and Photoshop may still finish it, so the next call waits
// until it settles. While a late call holds the queue, each call waiting
// behind it gets its own limit; a call answered while it waited never runs.
function createCallQueue({ schedule = setTimeout, cancel = clearTimeout } = {}) {
  let tail = Promise.resolve();
  let late = 0;
  const waiting = new Set();
  return function enqueue(task, timeoutMs = 0, onTimeout = () => undefined) {
    let answered = false;
    let started = false;
    let overdue = false;
    let timer = null;
    let settle = null;
    const reply = new Promise((resolve, reject) => {
      settle = { resolve, reject };
    });
    const disarm = () => {
      if (timer !== null) cancel(timer);
      timer = null;
    };
    const answer = (deliver) => {
      if (answered) return;
      answered = true;
      disarm();
      waiting.delete(entry);
      try {
        deliver();
      } catch (error) {
        settle.reject(error);
      }
    };
    const expire = () => {
      timer = null;
      if (started) {
        overdue = true;
        late++;
        waiting.forEach((other) => other.arm());
      }
      answer(() => settle.resolve(onTimeout(started)));
    };
    const entry = {
      arm: () => {
        if (timeoutMs > 0 && timer === null && !answered) timer = schedule(expire, timeoutMs);
      },
    };
    waiting.add(entry);
    if (late > 0) entry.arm();
    const run = tail.then(() => {
      waiting.delete(entry);
      if (answered) return undefined;
      started = true;
      // The time spent waiting does not count against the call itself
      disarm();
      entry.arm();
      const work = Promise.resolve().then(task);
      work.then((value) => answer(() => settle.resolve(value)), (error) => answer(() => settle.reject(error)));
      return work.catch(() => undefined).then(() => {
        if (overdue) late--;
      });
    });
    tail = run.catch(() => {});
    return reply;
  };
}

module.exports = { parseCall, callTimeout, createCallQueue, CALL_TIMEOUT_MS, LONG_CALL_TIMEOUT_MS };
