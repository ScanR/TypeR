const ps = require('photoshop');
const {storage} = require('uxp');
const fs = storage.localFileSystem;

const JSX = [
  'var state = ScriptUI.environment.keyboardState;',
  'var string = "a";',
  'if (state.metaKey) string += "WINa";',
  'if (state.ctrlKey) string += "CTRLa";',
  'if (state.altKey) string += "ALTa";',
  'if (state.shiftKey) string += "SHIFTa";',
  'if (state.keyName) {',
  '  var name = state.keyName;',
  '  if (name === "Left") name = "ArrowLeft";',
  '  else if (name === "Right") name = "ArrowRight";',
  '  else if (name === "Up") name = "ArrowUp";',
  '  else if (name === "Down") name = "ArrowDown";',
  '  else if (name === "Return" || name === "Enter") name = "Enter";',
  '  else if (name === "Spacebar" || name === "Space") name = " ";',
  '  else if (name === "+") name = "PLUS";',
  '  else if (name === "-") name = "MINUS";',
  '  else if (name === "=") name = "EQUAL";',
  '  else if (name === "/") name = "DIVIDE";',
  '  else if (name === "*") name = "MULTIPLY";',
  '  if (name === "PLUS" || name === "MINUS" || name === "EQUAL" || name === "DIVIDE" || name === "MULTIPLY") string += name + "a";',
  '  else if (name === " ") string += "SPACEa";',
  '  else string += name.toUpperCase() + "a";',
  '}',
  'var file = new File(keysPath);',
  'file.encoding = "UTF8";',
  'file.open("w");',
  'file.write(string);',
  'file.close();',
].join('\n');

function quote(path) {
  return "'" + String(path).replace(/'/g, "'\\''") + "'";
}

async function writeText(folder, name, text) {
  const file = await folder.createFile(name, {overwrite: true});
  await file.write(text);
  return file;
}

async function runJsx(file) {
  const token = fs.createSessionToken(file);
  const command = [{
    _obj: 'AdobeScriptAutomation Scripts',
    javaScript: {_path: token, _kind: 'local'},
    javaScriptMessage: 'JSM',
    _options: {dialogOptions: 'dontDisplay'},
  }];
  try {
    await ps.action.batchPlay(command, {modalBehavior: 'execute'});
  } catch (_) {
    await ps.core.executeAsModal(() => ps.action.batchPlay(command, {}), {commandName: 'TypeR : clavier'});
  }
}

async function extractHelper() {
  const plugin = await fs.getPluginFolder();
  const packed = await plugin.getEntry('typer-keys.json');
  const binary = Uint8Array.from(atob(JSON.parse(await packed.read())), char => char.charCodeAt(0));
  const folder = await fs.getDataFolder();
  const dest = await folder.createFile('typer-keys', {overwrite: true});
  await dest.write(binary.buffer, {format: storage.formats.binary});
  return dest.nativePath;
}

// Stops every previous helper by path and by name: an orphan from an older
// build (no heartbeat) kept rewriting keys.txt and looked like a frozen
// helper. pkill skips its own ancestors, so the shell running this line is
// safe even though its arguments contain the helper path. The pid file older
// builds wrote is only deleted: killing the pid it named could hit an
// unrelated process that reused it. $PPID is expected to be Photoshop, the
// parent of app.system's sh; the helper checks that and exits once it is gone.
function helperCommand(helperPath, keysPath) {
  return [
    'rm -f ' + quote(keysPath + '.pid'),
    'pkill -f ' + quote(helperPath) + ' >/dev/null 2>&1 || true',
    'pkill -x typer-keys >/dev/null 2>&1 || true',
    'chmod +x ' + quote(helperPath),
    'xattr -dr com.apple.quarantine ' + quote(helperPath) + ' >/dev/null 2>&1 || true',
    quote(helperPath) + ' ' + quote(keysPath) + ' "$PPID" >/dev/null 2>&1 &',
  ].join(' ; ');
}

function helperScript(helperPath, keysPath) {
  return 'app.system(' + JSON.stringify(helperCommand(helperPath, keysPath)) + ');';
}

async function startHelper(helperPath, keysPath) {
  const folder = await fs.getDataFolder();
  const jsx = await writeText(folder, 'start-keys.jsx', helperScript(helperPath, keysPath));
  await runJsx(jsx);
}

async function prepareScriptUI(keysPath) {
  const folder = await fs.getDataFolder();
  return writeText(folder, 'read-keys.jsx', 'var keysPath = ' + JSON.stringify(keysPath) + ';\n' + JSX);
}

// The helper writes "state|beat": the beat moves at least once a second, so a
// frozen beat means a dead helper. ScriptUI writes the bare state.
function parseKeys(raw) {
  const text = String(raw || '').trim();
  const match = /^(.*)\|(\d+)$/.exec(text);
  if (!match) return {state: text || 'a', beat: null};
  return {state: match[1].trim() || 'a', beat: match[2]};
}

const HELPER_DELAY = 40;
const SCRIPTUI_DELAY = 150;
const STALL_MS = 6000;
// The helper beats every second: past this, the file is a dead helper's last
// state, and a key it saw held must not stay held until the restart.
const HELD_STALE_MS = 2500;
const RETRY_MS = [2000, 5000, 10000, 30000];
const SCRIPTUI_AFTER = 4;

// Decides what the poll loop does next. Pure, so it can be tested:
// - "start": (re)launch the helper (first start, stalled or failed start);
// - "scriptui": run the ScriptUI reader for this tick.
// ScriptUI runs a JSX through batchPlay on every tick, and Photoshop redraws
// its option bar and panels after each one: the visible refresh loop. It is
// only used when the helper never produced a single heartbeat after several
// launches (it cannot run on this Mac), and the helper keeps being retried.
function createWatchdog(now = Date.now()) {
  const state = {
    beat: null, beatAt: now, everBeat: false, attempts: 0,
    nextStart: now, starting: false, running: false,
  };
  const delay = () => RETRY_MS[Math.min(state.attempts, RETRY_MS.length) - 1] || RETRY_MS[0];
  return {
    state,
    scriptUI: () => !state.running && !state.everBeat && state.attempts >= SCRIPTUI_AFTER,
    stale: (time) => state.everBeat && time - state.beatAt > HELD_STALE_MS,
    shouldStart(time) {
      if (state.starting || time < state.nextStart) return false;
      if (!state.running) return true;
      return time - state.beatAt > STALL_MS;
    },
    started(time, ok) {
      state.attempts += 1;
      state.running = ok;
      state.beatAt = time;
      state.nextStart = time + delay();
    },
    read(beat, time) {
      if (beat === null || beat === state.beat) return false;
      state.beat = beat;
      state.beatAt = time;
      state.everBeat = true;
      state.running = true;
      state.attempts = 0;
      return true;
    },
  };
}

async function startGlobalKeys(onState) {
  const folder = await fs.getDataFolder();
  const keysFile = await writeText(folder, 'keys.txt', 'a');
  const keysPath = keysFile.nativePath;
  let helperPath = null;
  let scriptUI = null;
  let usingScriptUI = false;
  const dog = createWatchdog();
  let last = 'a';
  let failures = 0;
  let stopped = false;
  let timer = null;

  const launch = async () => {
    dog.state.starting = true;
    const now = Date.now();
    try {
      if (!helperPath) helperPath = await extractHelper();
      await startHelper(helperPath, keysPath);
      if (dog.state.attempts === 0 && !dog.state.everBeat) console.log('TypeR: global keyboard helper started');
      else console.warn('TypeR keyboard helper restarted (attempt ' + (dog.state.attempts + 1) + ')');
      dog.started(now, true);
    } catch (error) {
      // "host is in a modal state" at boot is common: retry later instead
      // of switching to ScriptUI for the whole session.
      dog.started(now, false);
      if (dog.state.attempts <= 2 || dog.state.attempts % 10 === 0) {
        console.warn('TypeR keyboard helper start', error.message || error);
      }
    } finally {
      dog.state.starting = false;
    }
  };

  const tick = async () => {
    if (stopped) return;
    try {
      const now = Date.now();
      if (dog.shouldStart(now)) await launch();
      const fallback = dog.scriptUI();
      if (fallback !== usingScriptUI) {
        usingScriptUI = fallback;
        if (fallback) console.error('TypeR keyboard helper unavailable: ScriptUI fallback');
      }
      if (usingScriptUI) {
        if (!scriptUI) scriptUI = await prepareScriptUI(keysPath);
        await runJsx(scriptUI);
      }
      const fresh = await folder.getEntry('keys.txt');
      const parsed = parseKeys(await fresh.read());
      const readAt = Date.now();
      if (dog.read(parsed.beat, readAt) && usingScriptUI) {
        usingScriptUI = false;
        console.log('TypeR: global keyboard helper back');
      }
      const state = dog.stale(readAt) ? 'a' : parsed.state;
      if (state !== last) {
        last = state;
        onState(state);
      }
      failures = 0;
    } catch (error) {
      failures += 1;
      if (failures === 3 || failures % 200 === 0) console.error('TypeR keyboard poll', error.message || error);
    }
    if (!stopped) timer = setTimeout(tick, usingScriptUI ? SCRIPTUI_DELAY : HELPER_DELAY);
  };
  timer = setTimeout(tick, 0);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

module.exports = {startGlobalKeys, parseKeys, createWatchdog, helperCommand, helperScript, STALL_MS, HELD_STALE_MS};
