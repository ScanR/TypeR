// Small adapter for the existing React UI. No CEP or executable script strings
// cross the bridge: only a known method name and JSON arguments are accepted.
import {request, showError} from './browser-rpc';
import {keysFromEvent} from './shortcut-key';
import {isVirtualPath} from './virtual-files';
const initial = window.typerUXP;
// The application is only ever required once init has answered
// (uxp-src/browser-entry.js): its translations, its fonts and its saved styles
// all come from this payload. Reaching here without it means the evaluation
// order was broken — say so plainly, since the symptom is otherwise a panel
// that never finishes loading with nothing to point at.
if (!initial) throw new Error('TypeR : le panneau a démarré avant l’initialisation du pont UXP.');
// The panel's own files (virtual-files.js) come back from init whole, and the
// locale files sit in the same mirror: a UXP plugin has nowhere to write them,
// and the panel reads them synchronously as it did under CEP. Everything that
// is written here is persisted by the host, one file per path.
const virtualFiles = {...initial.locales, ...initial.files};
let writing = Promise.resolve();
let writeError = null;
let keys = 'a';
let hostKeys = false;

function typingInPanel() {
  if (typeof document.hasFocus === 'function' && !document.hasFocus()) return false;
  const active = document.activeElement;
  return !!(active && active.closest('input, textarea, [contenteditable=true]') && !active.closest('.app-modal'));
}

function updateKeys(event) {
  if (hostKeys) return;
  const editable = event.target.closest('input, textarea, [contenteditable=true]');
  if (editable && !event.target.closest('.app-modal')) { keys = 'a'; return; }
  const list = keysFromEvent(event);
  keys = 'a' + (list.length ? list.join('a') + 'a' : '');
}
window.addEventListener('keydown', updateKeys, true);
window.addEventListener('keyup', updateKeys, true);
window.addEventListener('blur', () => { if (!hostKeys) keys = 'a'; });
window.addEventListener('message', event => {
  const data = event.data;
  if (!data || data.channel !== 'typer-host') return;
  if (event.source && window.uxpHost && event.source !== window.uxpHost) return;
  if (data.method === 'keys' && typeof data.state === 'string') {
    hostKeys = true;
    keys = data.state;
    return;
  }
  if (data.method === 'runCommand' && typeof window.__typerRunCommand === 'function') window.__typerRunCommand(data.command);
});

window.typerUXP.flushStorage = async () => {await writing; if (writeError) throw writeError;};
// The mirror answers the read that storageIO.js does to verify a write, so it
// has to hold the text before the host is asked and regardless of its answer.
const store = (path, text) => {
  virtualFiles[path] = text;
  const task = writing.then(() => request('writeVirtual', path, text));
  writing = task.then(() => {writeError = null;}, error => {writeError = error; showError(error);});
  return {err: 0};
};

window.cep = {
  util: {openURLInDefaultBrowser: url => request('openUrl', url).catch(showError)},
  fs: {
    NO_ERROR: 0, ERR_NOT_FOUND: 3,
    readFile(path) { return path in virtualFiles ? {data: virtualFiles[path], err: 0} : path.startsWith('file:') ? request('readFile', path) : {err: 3}; },
    writeFile(path, data) {
      if (isVirtualPath(path)) return store(path, String(data));
      // 'file:' ids are the files the user picked; UXP allows no other path.
      return path.startsWith('file:') ? request('writeFile', path, data) : {err: 3};
    },
    deleteFile(path) {
      if (!isVirtualPath(path)) return {err: 3};
      delete virtualFiles[path];
      request('deleteVirtual', path).catch(showError);
      return {err: 0};
    },
    showSaveDialogEx(_a, _b, _types, name) {return request('pickSave', name);},
    showOpenDialogEx() {return request('pickOpen');},
  },
};
const environment = {appLocale: initial.locale, appSkinInfo: {panelBackgroundColor: {color: {red: 50, green: 50, blue: 50}}, baseFontFamily: 'Arial', baseFontSize: 12}};
window.__adobe_cep__ = {getHostEnvironment: () => JSON.stringify(environment)};
window.SystemPath = {EXTENSION: 'extension', USER_DATA: 'userData'};
window.CSInterface = class {
  constructor() {this.hostEnvironment = environment;}
  getSystemPath() {return '';}
  getOSInformation() {return 'Mac OS';}
  getHostEnvironment() {return environment;}
  initResourceBundle() {return {};}
  addEventListener() {}
  removeEventListener() {}
  registerKeyEventsInterest() {}
  evalScript(code, callback = () => {}) {
    const match = /^([A-Za-z]+)\((.*)\)$/s.exec(code);
    if (!match) {showError(new Error('Commande TypeR non reconnue.')); callback('error'); return;}
    const method = match[1];
    if (method === 'getHotkeyPressed') {callback(typingInPanel() ? 'a' : keys); return;}
    if (method === 'getUserFonts') {callback(initial.fonts); return;}
    let args;
    try {args = JSON.parse(`[${match[2]}]`);} catch (error) {showError(error); callback('error'); return;}
    request(method, ...args).then(callback).catch(error => {
      showError(error);
      const text = error && error.message ? error.message : String(error || 'error');
      callback(method.startsWith('get') ? '{}' : method === 'nativeConfirm' ? '' : 'scriptError: ' + text);
    });
  }
};
