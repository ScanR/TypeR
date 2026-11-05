// Starts the native keyboard reader (uxp-src/native) and follows its reports.
// Both readers are small programs shipped base64-encoded (a .ccx may not
// carry an unsigned executable) and exit with Photoshop; their state file is
// read every 25 ms. macOS: started through ExtendScript's app.system.
// Windows: "TypeR Shortcuts.exe", a windowed .NET application started through
// ExtendScript's File.execute(), as a double click would: app.system goes
// through cmd.exe, whose console window flashes on screen. It ships only in
// UXP-Windows.ccx: TypeR-UXP.ccx, which clients up to 3.0.0 also installed on
// Windows, starts no reader there, and the panel replaces it with that package.
//
// The reader writes "<state>|<beat>" and moves the beat at least once a
// second. A beat that stops means a dead reader: its last state is dropped
// (a key it saw held must not stay held), and the reader is started again.
// A start that fails ("host is in a modal state" while Photoshop starts up)
// is retried the same way, with a growing delay.
const os = require("os");
const uxp = require("uxp");
const fs = require("fs");
const files = require("./files");
const keyboard = require("./keyboard");
const { runJsx, systemCall } = require("./jsx");

const POLL_MS = 25;
// Past this without a new beat, the state on disk is a dead reader's
const STALE_MS = 2500;
// Past this without a new beat, the reader is started again
const STALL_MS = 6000;
// Delay before the next start after the 1st, 2nd, 3rd... failed one
const RETRY_MS = [2000, 5000, 10000, 30000];
// Starts in a row without a reader that stayed up before giving up for the
// session
const MAX_ATTEMPTS = 10;
// A reader beating for this long since its start counts as healthy, and
// only then are the attempts reset: one that beats once and dies is not
// restarted forever
const HEALTHY_MS = 30000;

let timer = null;
let mouseListener = null;
let focusListener = null;
// A theft that lasts is reported again this often: Photoshop may have been
// busy when the focus was first given back
const FOCUS_RETRY_MS = 1000;
let lastFocusReport = 0;
let focusReports = 0;
let lastReport = null;
let readerSamples = 0;
let readerError = "";
let lastMouseLine = "";
let started = false;
let accessPath = null;

const shellQuote = (value) => "'" + String(value).replace(/'/g, "'\\''") + "'";

// "<state>|<beat>", with "|F" while a Photoshop tooltip holds the keyboard
// focus (Windows reader); anything else (the "a" TypeR writes before the first
// start) has no beat
function parseState(text) {
  const value = String(text || "").trim();
  const match = /^(.*?)\|(\d+)(\|F)?$/.exec(value);
  if (!match) return { state: value || "a", beat: null, focusStolen: false };
  return { state: match[1].trim() || "a", beat: match[2], focusStolen: !!match[3] };
}

// When to (re)start the reader and whether its last state is still current.
// Pure apart from the times it is given, so scripts/testUxpHost.js drives it.
function createWatchdog(now = 0) {
  const state = { beat: null, beatAt: null, startedAt: null, attempts: 0, nextStart: now, running: false, starting: false };
  const retryDelay = () => RETRY_MS[Math.min(state.attempts, RETRY_MS.length) - 1] || RETRY_MS[0];
  return {
    state,
    // A new beat value: the reader is alive
    read(beat, time) {
      if (beat === null || beat === state.beat) return false;
      state.beat = beat;
      state.beatAt = time;
      state.running = true;
      if (state.startedAt === null || time - state.startedAt >= HEALTHY_MS) state.attempts = 0;
      state.nextStart = time;
      return true;
    },
    fresh: (time) => state.beatAt !== null && time - state.beatAt <= STALE_MS,
    shouldStart(time) {
      if (state.starting || state.attempts >= MAX_ATTEMPTS || time < state.nextStart) return false;
      if (!state.running) return true;
      return time - Math.max(state.beatAt || 0, state.startedAt || 0) > STALL_MS;
    },
    // A start was attempted, ok when the command ran: the reader then has
    // the retry delay or STALL_MS, whichever is longer, to beat. Answers
    // true once the attempts are exhausted.
    started(time, ok) {
      state.attempts += 1;
      state.running = ok;
      if (ok) state.startedAt = time;
      state.nextStart = time + retryDelay();
      return state.attempts >= MAX_ATTEMPTS;
    },
  };
}

function base64ToBytes(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function readPluginFile(name) {
  const plugin = await uxp.storage.localFileSystem.getPluginFolder();
  const entry = await plugin.getEntry(name);
  return entry.read({ format: uxp.storage.formats.utf8 });
}

// runJsx answers "ERR <message>" when the script itself threw
async function runSystem(command) {
  const result = await systemCall(command);
  if (/^ERR /.test(String(result || ""))) throw new Error(result);
}

async function startMac(folder, statePath) {
  const packed = JSON.parse(await readPluginFile("native/typer-keys.json"));
  const binaryPath = files.joinPath(folder, "typer-keys");
  const bytes = base64ToBytes(packed.binary);
  let current = null;
  try {
    current = await files.readBinary(binaryPath);
  } catch (error) {}
  const same = current && current.length === bytes.length && current.every((value, index) => value === bytes[index]);
  // Only TypeR's own reader, by its path: a running one keeps its file busy
  // and must not write the state file next to its replacement
  const stopOld = "pkill -f " + shellQuote(binaryPath) + " >/dev/null 2>&1";
  if (!same) {
    await runSystem(stopOld);
    await files.writeBinary(binaryPath, bytes);
  }
  const command = [
    stopOld,
    "chmod 755 " + shellQuote(binaryPath),
    "xattr -d com.apple.quarantine " + shellQuote(binaryPath) + " >/dev/null 2>&1",
    // $PPID is Photoshop: app.system runs the command through /bin/sh
    "nohup " + shellQuote(binaryPath) + " " + shellQuote(statePath) + " $PPID >/dev/null 2>&1 &",
  ].join("; ");
  await runSystem(command);
}

// Named for the Task Manager, which also shows its description and icon
const WINDOWS_READER = "TypeR Shortcuts.exe";

async function startWindows(folder, statePath) {
  const packed = JSON.parse(await readPluginFile("native/typer-keys-win.json"));
  const binaryPath = files.joinPath(folder, WINDOWS_READER);
  const bytes = base64ToBytes(packed.binary);
  let current = null;
  try {
    current = await files.readBinary(binaryPath);
  } catch (error) {}
  const same = current && current.length === bytes.length && current.every((value, index) => value === bytes[index]);
  if (!same) await replaceWindowsReader(binaryPath, statePath, bytes, current !== null);
  // The reader takes its state file from its own folder: File.execute()
  // passes no argument
  if (statePath !== files.joinPath(folder, "state")) throw new Error("Unexpected keyboard state path");
  // A reader still running stops by itself once the new one has started
  // (the ".owner" file in typer-keys.cs)
  const result = await runJsx(
    "var reader = new File(" + JSON.stringify(binaryPath) + ");" +
      " reader.exists ? (reader.execute() ? 'OK' : 'ERR execute failed') : 'ERR missing reader';"
  );
  if (String(result || "") !== "OK") throw new Error(result || "Keyboard reader did not start");
  removeOldWindowsReaders(folder);
}

// A running reader keeps its .exe locked: an update first asks it to stop
// (any other ".owner" value makes it exit within ~1.5 s)
async function replaceWindowsReader(binaryPath, statePath, bytes, existed) {
  if (existed) await files.writeText(statePath + ".owner", "update");
  const until = Date.now() + 5000;
  for (;;) {
    try {
      await files.writeBinary(binaryPath, bytes);
      return;
    } catch (error) {
      if (!existed || Date.now() > until) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

// Readers of earlier test builds and the former PowerShell reader
async function removeOldWindowsReaders(folder) {
  try {
    for (const entry of await files.listFolder(folder)) {
      if (/^typer-keys(-[0-9a-f]+\.exe|\.ps1)$/i.test(entry.name)) await files.remove(files.joinPath(folder, entry.name));
    }
  } catch (error) {}
}

function readState(path) {
  try {
    return String(fs.readFileSync(path, { encoding: "utf-8" }) || "").trim();
  } catch (error) {
    return null;
  }
}

// True once per run of the plugin: a panel reload must not install it again
let platformPackageAsked = false;
function needsPlatformPackage() {
  if (os.platform() !== "win32" || WINDOWS_PACKAGE || platformPackageAsked) return false;
  platformPackageAsked = true;
  return true;
}

// Set at build time: only UXP-Windows.ccx carries the Windows reader
const WINDOWS_PACKAGE = typeof TYPER_WINDOWS_READER !== "undefined" && TYPER_WINDOWS_READER;

async function start(onMouseLine, onFocusStolen) {
  if (os.platform() === "win32" && !WINDOWS_PACKAGE) return false;
  mouseListener = onMouseLine || null;
  focusListener = onFocusStolen || null;
  if (started) return true;
  started = true;
  let statePath;
  let folder;
  try {
    await files.resolveFolders();
    folder = files.joinPath(files.getStorageRoot(), "keys");
    await files.ensureFolder(folder);
    statePath = files.joinPath(folder, "state");
    await files.writeText(statePath, "a");
    accessPath = statePath + ".access";
  } catch (error) {
    started = false;
    console.error("TypeR keyboard helper:", (error && error.message) || error);
    return false;
  }
  lastMouseLine = readState(statePath + ".mouse") || "";

  const watchdog = createWatchdog(Date.now());
  let last = { state: "a", beat: null };
  const launch = async () => {
    watchdog.state.starting = true;
    let ok = false;
    try {
      if (os.platform() === "win32") await startWindows(folder, statePath);
      else await startMac(folder, statePath);
      ok = true;
    } catch (error) {
      readerError = (error && error.message) || String(error);
      console.error("TypeR keyboard helper:", readerError);
    } finally {
      watchdog.state.starting = false;
    }
    const attempt = watchdog.state.attempts + 1;
    if (attempt > 1) console.warn("TypeR keyboard helper: start attempt " + attempt + (ok ? "" : " failed"));
    if (watchdog.started(Date.now(), ok)) console.error("TypeR keyboard helper: no report after " + attempt + " starts, giving up");
  };

  const poll = () => {
    const now = Date.now();
    const text = readState(statePath);
    // A file being replaced may not read: keep the last report
    if (text !== null) last = parseState(text);
    if (watchdog.read(last.beat, now)) readerSamples++;
    const fresh = watchdog.fresh(now);
    keyboard.setState(fresh ? last.state : "a");
    lastReport = fresh ? last : null;
    // A tooltip took the focus: reported once, then again while it lasts
    if (fresh && last.focusStolen && focusListener && now - lastFocusReport >= FOCUS_RETRY_MS) {
      lastFocusReport = now;
      focusReports++;
      focusListener();
    }
    if (watchdog.shouldStart(now)) launch();
    if (mouseListener) {
      const line = readState(statePath + ".mouse");
      // Each line is unique (helper pid and press number): a line that was
      // already on disk when TypeR started is an old press
      if (line && line !== lastMouseLine) {
        lastMouseLine = line;
        mouseListener(line.slice(line.indexOf(" ") + 1));
      }
    }
  };
  if (timer) clearInterval(timer);
  timer = setInterval(poll, POLL_MS);
  poll();
  return true;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

// macOS Input Monitoring as the reader last reported it (typer-keys.m)
function access() {
  const value = accessPath ? readState(accessPath) : null;
  if (value === "1") return "granted";
  return value === "0" ? "missing" : "unknown";
}

// What Settings > Debug shows (app_src/components/modal/keyboardDebug.jsx)
function diagnostics() {
  return {
    source: "helper", running: !!lastReport, loading: false, error: readerError, samples: readerSamples,
    foreground: null, state: lastReport ? lastReport.state : "a", lastKeys: "",
    focusStolen: !!(lastReport && lastReport.focusStolen), focusReports,
  };
}

module.exports = { start, stop, access, needsPlatformPackage, diagnostics, _internals: { parseState, createWatchdog, STALE_MS, STALL_MS, RETRY_MS, MAX_ATTEMPTS, HEALTHY_MS } };
