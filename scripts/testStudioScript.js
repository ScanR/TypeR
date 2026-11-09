// TypeR Studio's Open in Photoshop leaves a script for the panel: it goes in
// the tab that already holds it, or in a new tab, once, and only when fresh
const assert = require("assert");

const listeners = {};
const csInterface = {
  getSystemPath: () => "/Users/me/Library/Application Support",
  addEventListener: (type, listener) => { (listeners[type] = listeners[type] || []).push(listener); },
  removeEventListener: () => {},
};
const load = require("./helpers/loadAppModule")({ "./utils": { csInterface } });
const { parseStudioScript, findScriptTab, scriptTabAction, studioScriptPath, takeStudioScript } = load("app_src/studioScript.js");

const now = 1800000000000;
const sent = (fields) => JSON.stringify(Object.assign({ from: "TypeR Studio", version: 1, sent: now - 1000, name: "Chapter 12", text: "Hello\r\nWorld\r\n" }, fields));

// The file
assert.deepStrictEqual(parseStudioScript(sent(), now), { name: "Chapter 12", text: "Hello\nWorld\n" });
assert.strictEqual(parseStudioScript("{not json", now), null);
assert.strictEqual(parseStudioScript(sent({ from: "someone" }), now), null, "only from Studio");
assert.strictEqual(parseStudioScript(sent({ version: 2 }), now), null, "a newer format is left alone");
assert.strictEqual(parseStudioScript(sent({ text: " \n " }), now), null, "an empty script");
assert.strictEqual(parseStudioScript(sent({ sent: now - 7 * 60 * 60 * 1000 }), now), null, "from another session");
assert.strictEqual(parseStudioScript(sent({ sent: now + 5 * 60 * 1000 }), now), null, "from the future");
assert.ok(parseStudioScript(sent({ sent: now + 30 * 1000 }), now), "a clock a little ahead");
assert.strictEqual(parseStudioScript(sent({ name: "  Ch\n12 " }), now).name, "Ch 12");
assert.strictEqual(parseStudioScript(sent({ name: 12 }), now).name, "");

// The tab
const tabs = [
  { id: "a", name: "Tab 1", text: "" },
  { id: "b", name: "Ch 11", text: "Hello\nWorld" },
];
assert.strictEqual(findScriptTab(tabs, "Hello\r\nWorld\n\n").id, "b", "line breaks and blank ends don't count");
assert.strictEqual(findScriptTab(tabs, "Hello\nworld"), null, "case counts");
assert.deepStrictEqual(scriptTabAction(tabs, { name: "Chapter 12", text: "Hello\nWorld\n" }), { type: "switchTab", id: "b" });
assert.deepStrictEqual(
  scriptTabAction(tabs, { name: "Chapter 12", text: "Bye" }, () => "new"),
  { type: "addTab", id: "new", name: "Chapter 12", data: { text: "Bye", currentLineIndex: 0 } }
);
assert.ok(!("name" in scriptTabAction(tabs, { name: "", text: "Bye" })), "no name: the tab names itself");

// Where Studio leaves it
global.window = { SystemPath: { USER_DATA: "userData" } };
assert.strictEqual(studioScriptPath(), "/Users/me/Library/Application Support/TypeR/Studio/script.json", "CEP");
window.typerUXP = { storageRoot: "C:\\Users\\me\\AppData\\Roaming\\TypeR\\UXP" };
assert.strictEqual(studioScriptPath(), "C:\\Users\\me\\AppData\\Roaming\\TypeR\\Studio\\script.json", "UXP on Windows");
window.typerUXP = { storageRoot: "/Users/me/Library/Application Support/TypeR/UXP/" };
assert.strictEqual(studioScriptPath(), "/Users/me/Library/Application Support/TypeR/Studio/script.json", "UXP on a Mac");
window.typerUXP = { request: () => {} };
assert.strictEqual(studioScriptPath(), null, "a host without a storage folder");
delete window.typerUXP;
window.__typerWeb = {};
assert.strictEqual(studioScriptPath(), null, "inside TypeR Studio");
delete window.__typerWeb;

(async () => {
  // Taken once: removed before it's used. UXP's file calls answer with promises.
  const disk = { "/Users/me/Library/Application Support/TypeR/Studio/script.json": sent({ sent: Date.now() }) };
  window.cep = {
    fs: {
      ERR_NOT_FOUND: 3,
      readFile: async (file) => (file in disk ? { err: 0, data: disk[file] } : { err: 3 }),
      deleteFile: async (file) => (file in disk ? (delete disk[file], { err: 0 }) : { err: 3 }),
    },
  };
  assert.deepStrictEqual(await takeStudioScript(), { name: "Chapter 12", text: "Hello\nWorld\n" });
  assert.deepStrictEqual(disk, {});
  assert.strictEqual(await takeStudioScript(), null, "nothing left");

  // A file that can't be removed is not used: it would come back at each check
  disk["/Users/me/Library/Application Support/TypeR/Studio/script.json"] = sent({ sent: Date.now() });
  window.cep.fs.deleteFile = () => ({ err: 1 });
  assert.strictEqual(await takeStudioScript(), null);
  console.log("studioScript: ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
