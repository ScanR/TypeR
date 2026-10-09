// UXP panel: the CEP environment rebuilt for the WebView. TypeR's own files
// stay synchronous (a mirror filled at start), other files and dialogs go to
// the plugin host and return promises, Photoshop events and the keyboard
// state reach the panel in CEP's formats.
const assert = require("assert");
const createLoader = require("./helpers/loadAppModule");

const requests = [];
const handlers = {};
const replies = {
  readUserFile: (path) => (path === "/missing" ? Promise.reject(new Error("no such file or directory")) : Promise.resolve("content of " + path)),
  writeUserFile: () => Promise.resolve(true),
  writeMirror: () => Promise.resolve(true),
  deleteMirror: () => Promise.resolve(true),
  showOpenDialog: () => Promise.resolve(["/pages/1.psd", "/pages/2.psd"]),
  showSaveDialog: () => Promise.resolve("/out/file.json"),
  openUrl: () => Promise.resolve(),
  evalScript: (script) => Promise.resolve("result of " + script),
};
const bridge = {
  request: (method, ...args) => {
    requests.push({ method, args });
    return replies[method] ? replies[method](...args) : Promise.resolve(null);
  },
  notify: () => {},
  on: (type, handler) => { (handlers[type] = handlers[type] || []).push(handler); },
};

const documentEvents = [];
global.window = {};
global.document = {
  dispatchEvent: (event) => documentEvents.push(event.type),
};
global.Event = class { constructor(type) { this.type = type; } };

const load = createLoader({ "./bridge": bridge });
const { installCepEnvironment } = load("uxp-src/web/cepShim.js");

installCepEnvironment({
  extensionId: "typer",
  files: { storage: '{"language":"fr_FR"}', "storage.bak": "{}" },
  locales: {
    "locale/messages.properties": "yes=Yes\nmulti=first\\\nsecond",
    "locale/fr_FR/messages.properties": "yes=Oui",
  },
  hostEnvironment: { appLocale: "fr_FR", appUILocale: "fr_FR", appSkinInfo: { panelBackgroundColor: { color: { red: 50, green: 50, blue: 50 } } } },
  platform: "darwin",
  keys: "aWINaCTRLa",
  hidden: false,
});

(async () => {
  const cs = new window.CSInterface();
  const root = cs.getSystemPath(window.SystemPath.EXTENSION);
  const fs = window.cep.fs;

  // TypeR's own files answer at once, like CEP's cep.fs did
  assert.deepStrictEqual(fs.readFile(root + "/storage"), { err: 0, data: '{"language":"fr_FR"}' });
  assert.strictEqual(fs.readFile(root + "/storage_profiles").err, fs.ERR_NOT_FOUND);
  assert.deepStrictEqual(fs.writeFile(root + "/storage", "{}"), { err: 0 });
  assert.deepStrictEqual(fs.readFile(root + "/storage"), { err: 0, data: "{}" }, "A write is read back at once (storageIO verifies it)");
  assert.deepStrictEqual(requests.pop(), { method: "writeMirror", args: ["storage", "{}"] });
  assert.strictEqual(fs.deleteFile(root + "/storage.bak").err, 0);
  assert.strictEqual(fs.deleteFile(root + "/storage.bak").err, fs.ERR_NOT_FOUND);
  assert.strictEqual(fs.writeFile(root + "/app/host.jsx", "x").err, fs.ERR_CANT_WRITE, "Only storage files can be written");
  assert.deepStrictEqual(fs.readFile(root + "/locale/fr_FR/messages.properties"), { err: 0, data: "yes=Oui" });

  // Any other file is asynchronous
  const read = fs.readFile("/Users/me/style.json");
  assert.ok(read && typeof read.then === "function");
  assert.deepStrictEqual(await read, { err: 0, data: "content of /Users/me/style.json" });
  assert.strictEqual((await fs.readFile("/missing")).err, fs.ERR_NOT_FOUND);
  assert.deepStrictEqual(await fs.writeFile("/Users/me/font.otf", "AAH/", window.cep.encoding.Base64), { err: 0, data: true });
  assert.deepStrictEqual(requests[requests.length - 1], { method: "writeUserFile", args: ["/Users/me/font.otf", "AAH/", "Base64"] });
  assert.deepStrictEqual(await fs.showOpenDialogEx(true, false, null, null, ["psd"]), { err: 0, data: ["/pages/1.psd", "/pages/2.psd"] });
  assert.deepStrictEqual(requests[requests.length - 1].args[0], { multiple: true, directory: false, title: null, types: ["psd"] });
  assert.deepStrictEqual(await fs.showSaveDialogEx(false, false, ["json"], "TypeR.json"), { err: 0, data: "/out/file.json" });

  // Resource bundle of the Photoshop UI language, CEP's initResourceBundle
  assert.deepStrictEqual(cs.initResourceBundle(), { yes: "Oui", multi: "first\nsecond" });

  // Keyboard: answered from the reader's last report, no host round trip
  const before = requests.length;
  assert.strictEqual(await new Promise((resolve) => cs.evalScript("getHotkeyPressed()", resolve)), "aWINaCTRLa");
  handlers.keys.forEach((handler) => handler({ state: "aSHIFTaXa" }));
  assert.strictEqual(await new Promise((resolve) => cs.evalScript("getHotkeyPressed()", resolve)), "aSHIFTaXa");
  assert.strictEqual(requests.length, before);
  assert.strictEqual(await new Promise((resolve) => cs.evalScript("getUserFonts()", resolve)), "result of getUserFonts()");

  // Photoshop events in the PhotoshopJSONCallback format
  const events = [];
  cs.addEventListener("com.adobe.PhotoshopJSONCallback" + cs.getExtensionID(), (event) => events.push(event));
  handlers.psEvent.forEach((handler) => handler({ data: 'ver1,{"eventID":1936483188,"eventData":{}}' }));
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].data.indexOf("1936483188") !== -1, true);

  // Theme changes are announced the CEP way
  let themeChanged = 0;
  cs.addEventListener(window.CSInterface.THEME_COLOR_CHANGED_EVENT, () => themeChanged++);
  handlers.theme.forEach((handler) => handler({ hostEnvironment: { appSkinInfo: { panelBackgroundColor: { color: { red: 240, green: 240, blue: 240 } } } } }));
  assert.strictEqual(themeChanged, 1);
  assert.strictEqual(JSON.parse(window.__adobe_cep__.getHostEnvironment()).appSkinInfo.panelBackgroundColor.color.red, 240);

  // A collapsed panel reads as a hidden document
  assert.strictEqual(document.hidden, false);
  handlers.visibility.forEach((handler) => handler({ hidden: true }));
  assert.strictEqual(document.hidden, true);
  assert.deepStrictEqual(documentEvents, ["visibilitychange"]);

  console.log("UXP panel CEP environment tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
