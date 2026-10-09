// Starts the native keyboard reader (uxp-src/native) and follows its reports.
// macOS: a small binary shipped base64-encoded (a .ccx may not carry an
// unsigned executable). Windows: a PowerShell script. Both are started once
// per Photoshop session through ExtendScript's app.system and exit with
// Photoshop; their state file is read every 25 ms.
const os = require("os");
const uxp = require("uxp");
const fs = require("fs");
const files = require("./files");
const keyboard = require("./keyboard");
const { systemCall } = require("./jsx");

const POLL_MS = 25;
let timer = null;
let mouseListener = null;
let lastMouseLine = "";
let started = false;

const shellQuote = (value) => "'" + String(value).replace(/'/g, "'\\''") + "'";

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

async function startMac(folder, statePath) {
  const packed = JSON.parse(await readPluginFile("native/typer-keys.json"));
  const binaryPath = files.joinPath(folder, "typer-keys");
  const bytes = base64ToBytes(packed.binary);
  let current = null;
  try {
    current = await files.readBinary(binaryPath);
  } catch (error) {}
  const same = current && current.length === bytes.length && current.every((value, index) => value === bytes[index]);
  // A running helper keeps its file busy: stop it before replacing the binary
  const stopOld = "pkill -f " + shellQuote(binaryPath) + " >/dev/null 2>&1";
  if (!same) {
    await systemCall(stopOld);
    await files.writeBinary(binaryPath, bytes);
  }
  const command = [
    stopOld,
    "chmod 755 " + shellQuote(binaryPath),
    "xattr -d com.apple.quarantine " + shellQuote(binaryPath) + " >/dev/null 2>&1",
    // $PPID is Photoshop: app.system runs the command through /bin/sh
    "nohup " + shellQuote(binaryPath) + " " + shellQuote(statePath) + " $PPID >/dev/null 2>&1 &",
  ].join("; ");
  await systemCall(command);
}

async function startWindows(folder, statePath) {
  const script = await readPluginFile("native/typer-keys.ps1");
  const scriptPath = files.joinPath(folder, "typer-keys.ps1");
  await files.writeText(scriptPath, script);
  const quoted = (value) => '"' + String(value).replace(/"/g, "") + '"';
  await systemCall(
    "start \"\" /B powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File " +
      quoted(scriptPath) + " " + quoted(statePath)
  );
}

function readState(path) {
  try {
    return String(fs.readFileSync(path, { encoding: "utf-8" }) || "").trim();
  } catch (error) {
    return null;
  }
}

function poll(statePath) {
  const state = readState(statePath);
  if (state !== null) keyboard.setState(state || "a");
  if (mouseListener) {
    const line = readState(statePath + ".mouse");
    // Each line is unique (helper pid and press number): a line that was
    // already on disk when TypeR started is an old press
    if (line && line !== lastMouseLine) {
      lastMouseLine = line;
      mouseListener(line.slice(line.indexOf(" ") + 1));
    }
  }
}

async function start(onMouseLine) {
  mouseListener = onMouseLine || null;
  if (started) return true;
  started = true;
  const folder = files.joinPath(files.getStorageRoot(), "keys");
  await files.ensureFolder(folder);
  const statePath = files.joinPath(folder, "state");
  try {
    await files.writeText(statePath, "a");
    lastMouseLine = readState(statePath + ".mouse") || "";
    if (os.platform() === "win32") await startWindows(folder, statePath);
    else await startMac(folder, statePath);
  } catch (error) {
    started = false;
    console.error("TypeR keyboard helper:", (error && error.message) || error);
    return false;
  }
  if (timer) clearInterval(timer);
  timer = setInterval(() => poll(statePath), POLL_MS);
  return true;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop };
