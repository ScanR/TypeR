const {entrypoints, storage, shell} = require('uxp');
const ps = require('photoshop');
const {methods} = require('./photoshop');
const {methods: previewMethods} = require('./preview');
const {methods: layerMethods} = require('./layers');
const {methods: shaperMethods} = require('./textshaper');
const {COMMANDS, ACTION_SET, commandFromActionName} = require('./commands');
const {fileForPath, pathForFile} = require('./virtual-files');
const {startGlobalKeys} = require('./global-keys');
const fs = storage.localFileSystem;
const view = document.getElementById('typer-view');
const status = document.getElementById('status');
const files = new Map();
let fileId = 0;
let writeQueue = Promise.resolve();
let lastOpenedDocument = null;

function queueWrite(callback) {
  const result = writeQueue.then(callback, callback);
  writeQueue = result.catch(() => {});
  return result;
}

function parseStorage(text) {
  if (typeof text !== 'string') return null;
  try {
    const data = JSON.parse(text);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch (error) { return null; }
}

// Every path the panel stores under (uxp-src/virtual-files.js) is one file
// here. They are read once at init and handed to the panel whole: its file
// system calls are synchronous, as CEP's were, so it reads them from memory.
async function loadVirtualFiles() {
  const folder = await fs.getDataFolder();
  const contents = {};
  for (const entry of await folder.getEntries()) {
    if (!entry.isFile) continue;
    const path = pathForFile(entry.name);
    if (path) contents[path] = await entry.read();
  }
  return contents;
}

async function writeVirtualFile(path, text) {
  const name = fileForPath(path);
  if (!name) throw new Error(`Fichier TypeR non autorisé : ${path}`);
  return queueWrite(async () => {
    const folder = await fs.getDataFolder();
    const file = await folder.createFile(name, {overwrite: true});
    await file.write(String(text));
    return true;
  });
}

async function deleteVirtualFile(path) {
  const name = fileForPath(path);
  if (!name) return false;
  return queueWrite(async () => {
    const folder = await fs.getDataFolder();
    const entry = (await folder.getEntries()).find(item => item.name === name);
    if (entry) await entry.delete();
    return true;
  });
}

function confirmDialog({text, title}) {
  return new Promise((resolve, reject) => {
    const dialog = document.createElement('dialog');
    const heading = document.createElement('h3');
    heading.textContent = title || 'TypeR';
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    const cancel = document.createElement('sp-button');
    cancel.textContent = 'Annuler';
    const accept = document.createElement('sp-button');
    accept.textContent = 'Confirmer';
    cancel.addEventListener('click', () => dialog.close('cancel'));
    accept.addEventListener('click', () => dialog.close('confirm'));
    dialog.appendChild(heading); dialog.appendChild(paragraph);
    dialog.appendChild(cancel); dialog.appendChild(accept);
    document.body.appendChild(dialog);
    dialog.uxpShowModal({title: title || 'TypeR', resize: 'none', size: {width: 420, height: 220}})
      .then(result => resolve(result === 'confirm' ? '1' : ''), reject)
      .finally(() => dialog.remove());
  });
}

const handlers = {
  ...methods,
  ...previewMethods,
  ...layerMethods,
  ...shaperMethods,
  async init() {
    const folder = await fs.getPluginFolder();
    const locales = {};
    const localeFolder = await folder.getEntry('locale');
    for (const entry of await localeFolder.getEntries()) {
      if (entry.isFile && entry.name === 'messages.properties') locales['/locale/messages.properties'] = await entry.read();
      if (entry.isFolder) {
        const messages = await entry.getEntry('messages.properties');
        locales[`/locale/${entry.name}/messages.properties`] = await messages.read();
      }
    }
    const files = await loadVirtualFiles();
    // A local UXP plugin must not offer the CEP updater, whose installer would
    // overwrite the plugin's own files with a CEP release. What the panel reads
    // keeps it off; it is the value its settings screen shows.
    const storage = parseStorage(files['/storage']);
    if (storage) files['/storage'] = JSON.stringify({...storage, checkUpdates: false});
    return {files, locales, fonts: await methods.getUserFonts(), locale: ps.app.locale || 'fr_FR'};
  },
  writeVirtual: writeVirtualFile,
  deleteVirtual: deleteVirtualFile,
  // The panel document's console is not part of Photoshop's UXP log, so the
  // panel reports its own failures here (uxp-src/panel.html). A crash in the
  // panel otherwise shows as a placeholder that never goes away.
  async panelLog(text) {
    console.log('TypeR panel:', text);
    if (/^panel (error|rejection)/.test(text)) status.textContent = text;
    return '';
  },
  async openUrl(url) {
    if (!/^https:\/\/(typer\.hayasaku\.fr|github\.com|youtu\.be|discord\.gg)(\/|$)/.test(url)) throw new Error('Lien externe non reconnu.');
    const error = await shell.openExternal(url);
    if (error) throw new Error(error);
    return '';
  },
  async nativeAlert(data) { await ps.app.showAlert(data.text || 'TypeR'); return ''; },
  nativeConfirm: confirmDialog,
  async pickSave(name) {
    const file = await fs.getFileForSaving(name || 'TypeR.json', {types: ['json']});
    if (!file) return {data: ''};
    const id = `file:${++fileId}`;
    files.set(id, file);
    return {data: id};
  },
  async pickOpen() {
    const selected = await fs.getFileForOpening({types: ['json'], allowMultiple: true});
    if (!selected) return {data: []};
    const entries = Array.isArray(selected) ? selected : [selected];
    return {data: entries.map(entry => {const id = `file:${++fileId}`; files.set(id, entry); return id;})};
  },
  async readFile(id) {
    if (!files.has(id)) throw new Error('Sélectionnez de nouveau le fichier.');
    return {data: await files.get(id).read(), err: 0};
  },
  async writeFile(id, text) {
    if (!files.has(id)) throw new Error('Sélectionnez de nouveau le fichier.');
    await files.get(id).write(text);
    return {err: 0};
  },
  async pickImages() {
    const selected = await fs.getFileForOpening({types: ['psd', 'psb', 'png', 'jpg', 'jpeg'], allowMultiple: true});
    if (!selected) return [];
    const entries = Array.isArray(selected) ? selected : [selected];
    return Promise.all(entries.map(async entry => ({name: entry.name, baseName: entry.name.replace(/\.[^.]+$/, ''), path: `psfile:${await fs.createPersistentToken(entry)}`})));
  },
  async openFile(token, autoClose) {
    if (typeof token !== 'string' || !token.startsWith('psfile:')) throw new Error('Resélectionnez les PSD dans TypeR Silicon pour autoriser leur ouverture.');
    const entry = await fs.getEntryForPersistentToken(token.slice(7));
    let opened = null;
    await ps.core.executeAsModal(async () => {
      const previous = lastOpenedDocument && Array.from(ps.app.documents).find(doc => doc.id === lastOpenedDocument);
      // Open the new page first so a missing file cannot close the current one.
      const next = await ps.app.open(entry);
      if (autoClose && previous && previous.id !== next.id) await previous.close(ps.constants.SaveOptions.SAVECHANGES);
      lastOpenedDocument = next.id;
      opened = next.id;
    }, {commandName: 'TypeR : ouvrir la page'});
    // The panel reads this as JSON, the way it read the CEP host's answer
    // ({ok, path, documentKey}): anything that parses to nothing counts as a
    // failure and raises "Impossible d'ouvrir cette page". An empty string here
    // therefore reported a failure for every page that opened — and since the
    // panel retries whenever the current line changes, the alert kept coming
    // back on its own. Failures stay exceptions: the panel shows their text.
    return JSON.stringify({ok: true, path: token, documentKey: String(opened)});
  },
};

let sawFirstMessage = false;
window.addEventListener('message', async event => {
  // A message with no source at all is still ours — only the panel document
  // ever posts to this window, and refusing it would hang every request in the
  // panel. The reverse-direction guard (uxp-src/csinterface.js) reads it the
  // same way.
  if (event.source && event.source !== view) return;
  const message = event.data;
  if (!message || message.channel !== 'typer-uxp' || !Number.isSafeInteger(message.id) || !Array.isArray(message.args)) return;
  // The first message proves the panel document is running at all; after that
  // only init is worth a line, since the panel polls constantly.
  if (!sawFirstMessage) { sawFirstMessage = true; console.log('TypeR: first panel message', message.method); }
  if (message.method === 'init') console.log('TypeR: init requested');
  try {
    // An unknown method must answer, not stay silent: the panel awaits every
    // call, so dropping it would freeze the action that triggered it.
    if (!Object.prototype.hasOwnProperty.call(handlers, message.method)) throw new Error(`Commande ${message.method} non prise en charge par TypeR Silicon.`);
    const result = await handlers[message.method](...message.args);
    if (message.method === 'init') console.log('TypeR: init done, payload', JSON.stringify(result).length, 'bytes');
    view.postMessage({channel: 'typer-uxp', id: message.id, result});
    if (message.method === 'init') status.style.display = 'none';
  } catch (error) {
    const text = error.message || String(error);
    console.error('TypeR', message.method, text);
    status.textContent = text;
    status.style.display = 'block';
    view.postMessage({channel: 'typer-uxp', id: message.id, error: text});
  }
});

function runHostCommand(command) {
  if (!view || typeof view.postMessage !== 'function') {
    ps.app.showAlert('Ouvrez le panneau TypeR Silicon une fois, puis réessayez.');
    return;
  }
  view.postMessage({channel: 'typer-host', method: 'runCommand', command});
}

async function typerHostCommand(_context, info = {}) {
  runHostCommand(info.command);
}

function actionNameFromPlay(descriptor) {
  const target = descriptor?._target;
  if (!Array.isArray(target) || !target[0]) return '';
  return target[0]._name || '';
}

function onActionPlay(_event, descriptor) {
  if (descriptor?._isCommand) return;
  const command = commandFromActionName(actionNameFromPlay(descriptor));
  if (command) runHostCommand(command);
}

async function ensureActions() {
  try {
    await ps.core.executeAsModal(async () => {
      const tree = Array.from(ps.app.actionTree || []);
      if (!tree.some(set => set.name === ACTION_SET)) {
        await ps.action.batchPlay([{_obj: 'make', _target: [{_ref: 'actionSet'}], using: {_obj: 'actionSet', name: ACTION_SET}}], {});
      }
      const set = Array.from(ps.app.actionTree || []).find(item => item.name === ACTION_SET);
      const existing = new Set(Array.from(set?.actions || []).map(action => action.name));
      for (const item of COMMANDS) {
        if (existing.has(item.actionName)) continue;
        await ps.action.batchPlay([{
          _obj: 'make',
          _target: [{_ref: 'action'}],
          using: {_obj: 'action', name: item.actionName},
          at: {_ref: 'actionSet', _name: ACTION_SET},
        }], {});
      }
    }, {commandName: 'TypeR : raccourcis globaux'});
  } catch (error) {
    console.error('TypeR actions', error.message || error);
  }
}

async function startGlobalShortcuts() {
  globalThis.typerHostCommand = typerHostCommand;
  try { await ps.action.addNotificationListener(['play'], onActionPlay); }
  catch (error) { console.error('TypeR play listener', error.message || error); }
  await ensureActions();
}

view.addEventListener('loaderror', event => { status.textContent = `Impossible de charger TypeR : ${event.message}`; });
// Boot breadcrumbs: the placeholder above is only removed once init has been
// answered, so the console has to say how far the panel document got.
view.addEventListener('load', () => console.log('TypeR: panel document loaded'));
view.src = 'plugin:/web/index.html';
entrypoints.setup({
  panels: {typer: {
    create() { console.log('TypeR: panel created'); },
    show() { console.log('TypeR: panel shown'); ensureActions(); },
    hide() {},
  }},
  plugin: {
    create() {
      console.log('TypeR: plugin loaded');
      startGlobalShortcuts();
      startGlobalKeys(state => view.postMessage({channel: 'typer-host', method: 'keys', state})).catch(error => {
        console.error('TypeR keyboard', error.message || error);
      });
    },
    destroy() {return writeQueue;},
  },
});
