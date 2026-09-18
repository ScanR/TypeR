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

async function startHelper(helperPath, keysPath) {
  const folder = await fs.getDataFolder();
  const cmd = [
    'pkill -x typer-keys >/dev/null 2>&1 || true',
    'chmod +x ' + quote(helperPath),
    'xattr -dr com.apple.quarantine ' + quote(helperPath) + ' >/dev/null 2>&1 || true',
    quote(helperPath) + ' ' + quote(keysPath) + ' >/dev/null 2>&1 &',
  ].join(' ; ');
  const jsx = await writeText(folder, 'start-keys.jsx', 'app.system(' + JSON.stringify(cmd) + ');');
  await runJsx(jsx);
}

async function prepareScriptUI(keysPath) {
  const folder = await fs.getDataFolder();
  return writeText(folder, 'read-keys.jsx', 'var keysPath = ' + JSON.stringify(keysPath) + ';\n' + JSX);
}

async function startGlobalKeys(onState) {
  const folder = await fs.getDataFolder();
  const keysFile = await writeText(folder, 'keys.txt', 'a');
  const keysPath = keysFile.nativePath;
  let helper = false;
  let scriptUI = null;
  try {
    const helperPath = await extractHelper();
    await startHelper(helperPath, keysPath);
    helper = true;
    console.log('TypeR: global keyboard helper started');
  } catch (error) {
    console.error('TypeR keyboard helper', error.message || error);
    scriptUI = await prepareScriptUI(keysPath);
  }
  let last = 'a';
  let failures = 0;
  const timer = setInterval(async () => {
    try {
      if (!helper) {
        if (!scriptUI) scriptUI = await prepareScriptUI(keysPath);
        await runJsx(scriptUI);
      }
      const fresh = await folder.getEntry('keys.txt');
      const text = ((await fresh.read()) || 'a').trim() || 'a';
      if (text !== last) {
        last = text;
        onState(text);
      }
      failures = 0;
    } catch (error) {
      failures += 1;
      if (failures === 3) console.error('TypeR keyboard poll', error.message || error);
      if (failures > 20) helper = false;
    }
  }, helper ? 40 : 80);
  return () => clearInterval(timer);
}

module.exports = {startGlobalKeys};
