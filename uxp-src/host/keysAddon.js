// TypeR UXP addon reader v1. Default Windows keyboard reader.
// An addon failure never falls back to an executable.
// The addon also tells when a Photoshop tooltip holds the keyboard focus
// (focusStolen, keys.h): the listener given to start() gives it back.
const keyboard = require("./keyboard");
const POLL_MS = 25;
// A theft that lasts is reported again this often: Photoshop may have been
// busy when the focus was first given back
const FOCUS_RETRY_MS = 1000;

function parseSnapshot(text) {
  const snapshot = JSON.parse(text);
  if (!snapshot || snapshot.apiVersion !== 1 || typeof snapshot.foreground !== "boolean" ||
      typeof snapshot.state !== "string" || !/^a(?:[A-Z0-9]+a)*$/.test(snapshot.state) ||
      !Number.isInteger(snapshot.mouseDown) || snapshot.mouseDown < 0 || snapshot.mouseDown > 3 ||
      !Number.isInteger(snapshot.mousePressed) || snapshot.mousePressed < 0 || snapshot.mousePressed > 3 ||
      typeof snapshot.mouseModifiers !== "string" || !/^W?C?A?S?$/.test(snapshot.mouseModifiers) ||
      (snapshot.focusStolen !== undefined && typeof snapshot.focusStolen !== "boolean")) {
    throw new Error("Incompatible TypeR keyboard addon snapshot");
  }
  return snapshot;
}

function createReader({ loadAddon, setState, schedule = setInterval, cancel = clearInterval, reportError = console.error, now = Date.now }) {
  let timer = null;
  let addon = null;
  let mouseListener = null;
  let focusListener = null;
  let lastFocusReport = 0;
  let focusReports = 0;
  let previous = null;
  let running = false;
  let loading = false;
  let generation = 0;
  let startTask = null;
  let lastError = "";
  let sampledAt = 0;
  let samples = 0;
  let lastKeys = "a";

  function diagnostics() {
    return { source: "uxpaddon", running, loading, error: lastError, sampledAt, samples,
      foreground: previous ? previous.foreground : null,
      state: previous && previous.foreground ? previous.state : "a", lastKeys,
      focusStolen: isStolen(previous), focusReports };
  }

  const isStolen = (snapshot) => !!(snapshot && snapshot.foreground && snapshot.focusStolen === true);

  function fail(error) {
    stop();
    lastError = (error && error.message) || String(error);
    reportError("TypeR keyboard addon:", lastError);
  }

  function stop() {
    generation++;
    startTask = null;
    loading = false;
    running = false;
    if (timer !== null) cancel(timer);
    timer = null;
    previous = null;
    mouseListener = null;
    focusListener = null;
    addon = null;
    setState("a");
  }

  function poll() {
    try {
      const snapshot = parseSnapshot(addon.readSnapshot());
      sampledAt = now();
      samples++;
      if (snapshot.foreground && snapshot.state !== "a") lastKeys = snapshot.state;
      setState(snapshot.foreground ? snapshot.state : "a");
      // Baseline on start and on return to Photoshop: an old mouse press in
      // another application must not turn into a TypeR command.
      if (snapshot.foreground && previous && previous.foreground && mouseListener) {
        const pressed = (snapshot.mouseDown | snapshot.mousePressed) & ~previous.mouseDown;
        for (let index = 0; index < 2; index++) {
          if (pressed & (1 << index)) mouseListener("MB|" + (index + 5) + "|" + snapshot.mouseModifiers + "|Photoshop");
        }
      }
      // A tooltip took the focus: reported once, then again while it lasts
      if (isStolen(snapshot) && focusListener && (!isStolen(previous) || sampledAt - lastFocusReport >= FOCUS_RETRY_MS)) {
        lastFocusReport = sampledAt;
        focusReports++;
        focusListener();
      }
      previous = snapshot;
      return true;
    } catch (error) {
      fail(error);
      return false;
    }
  }

  function start(onMouseLine, onFocusStolen) {
    mouseListener = onMouseLine || null;
    focusListener = onFocusStolen || null;
    if (running) return Promise.resolve(true);
    if (startTask) return startTask;
    lastError = "";
    lastKeys = "a";
    sampledAt = 0;
    samples = 0;
    const attempt = ++generation;
    loading = true;
    startTask = (async () => {
      try {
        // Photoshop's SDK sample awaits require(.uxpaddon). Resolve the
        // native module before inspecting exports; also accept sync loaders.
        const loaded = await Promise.resolve().then(loadAddon);
        if (attempt !== generation) return false;
        if (!loaded || typeof loaded.readSnapshot !== "function") {
          throw new Error("TypeR keyboard addon is missing readSnapshot (exports: " +
            (loaded ? Object.keys(loaded).join(", ") || "none" : String(loaded)) + ")");
        }
        addon = loaded;
        loading = false;
        running = true;
        if (!poll()) return false;
        timer = schedule(poll, POLL_MS);
        return true;
      } catch (error) {
        // A load completing after stop/restart must not restart the reader
        // or overwrite the new attempt's state or error.
        if (attempt === generation) fail(error);
        return false;
      } finally {
        if (attempt === generation) {
          startTask = null;
          loading = false;
        }
      }
    })();
    return startTask;
  }

  return { start, stop, diagnostics, access: () => running ? "granted" : loading ? "unknown" : "missing" };
}

// The reader of 3.0.0 and its files, once updated: it exits within ~1.5 s when
// its owner file changes, and keeps its program busy until then. A failure is
// tried again at the next start.
async function removeOldReader(files, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
  await files.resolveFolders();
  const folder = files.joinPath(files.getStorageRoot(), "keys");
  if (!(await files.exists(folder))) return true;
  await files.writeText(files.joinPath(folder, "state.owner"), "update");
  for (let attempt = 0; attempt < 8; attempt++) {
    await wait(750);
    try {
      await files.removeTree(folder);
      if (!(await files.exists(folder))) return true;
    } catch (error) {}
  }
  return false;
}

const reader = createReader({
  // Kept external by webpack: Adobe resolves win/x64/ through the manifest.
  loadAddon: () => require("typer-keys.uxpaddon"),
  setState: (state) => keyboard.setState(state),
});

module.exports = {
  start: async (onMouseLine, onFocusStolen) => {
    removeOldReader(require("./files")).catch((error) => console.warn("TypeR: old keyboard reader", error));
    return reader.start(onMouseLine, onFocusStolen);
  },
  needsPlatformPackage: () => false,
  stop: reader.stop,
  access: reader.access,
  diagnostics: reader.diagnostics,
  _internals: { createReader, parseSnapshot, removeOldReader, POLL_MS, FOCUS_RETRY_MS },
};
