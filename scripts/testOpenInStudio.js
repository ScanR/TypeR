// Open in TypeR Studio: which documents are saved and how, where TypeR Studio
// is looked for, the request it takes, and its download
const assert = require("assert");

const calls = [];
let hostAnswers = {};
const csInterface = {
  getSystemPath: () => "/Users/me/Library/Application Support",
  evalScript: (script, done) => {
    calls.push(script);
    const name = script.slice(0, script.indexOf("("));
    done(hostAnswers[name] ? hostAnswers[name](script) : "");
  },
};
const safeJsonParse = (raw, fallback = {}) => {
  try {
    return JSON.parse(raw) || fallback;
  } catch (error) {
    return fallback;
  }
};
const load = require("./helpers/loadAppModule")({
  "./utils": { csInterface, safeJsonParse },
  "./uxpMigration": { getNode: () => null },
});
const studio = load("app_src/openInStudio.js");

const disk = {};
global.window = {
  SystemPath: { USER_DATA: "userData" },
  typerUXP: {
    storageRoot: "/Users/me/Library/Application Support/TypeR/UXP",
    platform: "darwin",
    arch: "arm64",
    request: async (name, path) => ({ exists: name === "stat" && path in disk }),
  },
  cep: {
    fs: {
      readFile: async (path) => (path in disk ? { err: 0, data: disk[path] } : { err: 3 }),
      writeFile: async (path, data) => { disk[path] = data; return { err: 0 }; },
    },
    util: { openURLInDefaultBrowser: async (url) => { calls.push(url); } },
  },
};

(async () => {
  // What each document needs
  const docs = [
    { id: 1, name: "01.psd", path: "/c/01.psd", saved: true },
    { id: 2, name: "02.psd", path: "/c/02.psd", saved: false },
    { id: 3, name: "03.png", path: "/c/03.png", saved: true },
    { id: 4, name: "04.png", path: "/c/04.png", saved: false },
    { id: 5, name: "Untitled-1", path: "", saved: false },
    { id: 6, name: "06.tif", path: "/c/06.tif", saved: true },
  ];
  assert.deepStrictEqual(studio.planStudioDocuments(docs).map((entry) => entry.step), ["ready", "save", "ready", "psd", "psd", "psd"]);

  // Saved in place or as a PSD in the folder chosen, in the documents' order
  hostAnswers.saveStudioDocuments = (script) => JSON.stringify(JSON.parse(script.slice("saveStudioDocuments(".length, -1))
    .map((item) => ({ id: item.id, path: item.folder ? item.folder + "/" + item.name + ".psd" : "/c/0" + item.id + ".psd" })));
  let asked = null;
  const files = await studio.saveForStudio(docs, async (near) => { asked = near; return "/out"; });
  assert.strictEqual(asked, "/c", "the folder dialog starts near the pages");
  assert.deepStrictEqual(files, ["/c/01.psd", "/c/02.psd", "/c/03.png", "/out/04.psd", "/out/Untitled-1.psd", "/out/06.psd"]);
  assert.strictEqual(await studio.saveForStudio(docs, async () => null), null, "no folder: nothing is sent");
  calls.length = 0;
  assert.deepStrictEqual(await studio.saveForStudio(docs.slice(0, 1), async () => { throw new Error("asked"); }), ["/c/01.psd"]);
  assert.strictEqual(calls.length, 0, "nothing to save, nothing asked of Photoshop");
  hostAnswers.saveStudioDocuments = () => JSON.stringify([{ id: 2, error: "locked" }]);
  assert.deepStrictEqual(await studio.saveForStudio(docs.slice(0, 2), async () => "/out"), { error: "locked", name: "02.psd" });

  // Where TypeR Studio is looked for
  assert.strictEqual(await studio.isStudioInstalled(), false);
  disk["/Users/me/Applications/TypeR Studio.app"] = "";
  assert.strictEqual(await studio.isStudioInstalled(), true, "in the user's Applications");
  delete disk["/Users/me/Applications/TypeR Studio.app"];
  disk["/Users/me/Library/Application Support/TypeR/Studio/app.json"] = JSON.stringify({ path: "/Volumes/Apps/TypeR Studio.app" });
  assert.strictEqual(await studio.isStudioInstalled(), false, "where it said, but no longer there");
  disk["/Volumes/Apps/TypeR Studio.app"] = "";
  assert.strictEqual(await studio.isStudioInstalled(), true, "where it said it is");

  // The request, then the link
  calls.length = 0;
  await studio.writeStudioRequest(["/c/01.psd"], { name: "Ch 12", text: "Hello" });
  const request = JSON.parse(disk["/Users/me/Library/Application Support/TypeR/Studio/open.json"]);
  assert.strictEqual(request.from, "TypeR");
  assert.strictEqual(request.version, 1);
  assert.deepStrictEqual(request.files, ["/c/01.psd"]);
  assert.deepStrictEqual(request.script, { name: "Ch 12", text: "Hello" });
  await studio.writeStudioRequest(["/c/01.psd"], { name: "Empty", text: " \n" });
  assert.ok(!("script" in JSON.parse(disk["/Users/me/Library/Application Support/TypeR/Studio/open.json"])), "an empty script isn't sent");
  await studio.launchStudio();
  assert.deepStrictEqual(calls, ["typer-studio://open"]);

  // The download for this computer
  assert.strictEqual(studio.studioDownloadUrl(), studio.DOWNLOADS.macArm);
  window.typerUXP.arch = "x64";
  assert.strictEqual(studio.studioDownloadUrl(), studio.DOWNLOADS.macIntel);
  window.typerUXP.platform = "win32";
  assert.strictEqual(studio.studioDownloadUrl(), studio.DOWNLOADS.windows);

  // Windows: TypeR Studio's installer puts it in the user's programs
  window.typerUXP.storageRoot = "C:\\Users\\me\\AppData\\Roaming\\TypeR\\UXP";
  disk["C:\\Users\\me\\AppData\\Local\\Programs\\typer-studio\\TypeR Studio.exe"] = "";
  assert.strictEqual(await studio.isStudioInstalled(), true);

  // Not inside TypeR Studio itself: there, the button is Studio's Open in Photoshop
  assert.strictEqual(studio.photoshopFromStudio(), null);
  window.__typerWeb = {};
  assert.strictEqual(studio.studioAvailable(), false);
  assert.strictEqual(studio.otherAppAvailable(), false, "Studio in a browser: no Photoshop to open");
  window.__typerWeb.openInPhotoshop = () => "opened";
  assert.strictEqual(studio.photoshopFromStudio()(), "opened");
  assert.strictEqual(studio.otherAppAvailable(), true);
  console.log("openInStudio: ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
