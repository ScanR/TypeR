// Script tabs: a tab the user never renamed takes its name from its PSD folder,
// a chapter heading or its first sentence, and a chosen name is never touched
const assert = require("assert");
const load = require("./helpers/loadAppModule")();
const { applyAutoTabNames, getAutoTabName, getNextDefaultTabName } = load("app_src/tabNames.js");

const label = "Onglet";
const pages = (...paths) => paths.map((path) => ({ path }));
const name = (tab, options) => getAutoTabName(tab, options);

// PSD folder, as the user names them by hand
assert.strictEqual(name({ images: pages("/Users/sakushi/Desktop/105/01.psd", "/Users/sakushi/Desktop/105/02.psd") }), "105");
assert.strictEqual(name({ images: pages("/Users/sakushi/Downloads/starblo 39/01.psd") }), "starblo 39");
assert.strictEqual(name({ images: pages("C:\\Users\\me\\Documents\\Solo Leveling 12\\01.psd") }), "Solo Leveling 12");
assert.strictEqual(name({ images: pages("/Users/me/Downloads/Ch 12/PSD/01.psd") }), "Ch 12", "a storage folder looks one level up");
assert.strictEqual(name({ images: pages("/Users/me/Work/Serie/a/01.psd", "/Users/me/Work/Serie/b/01.psd") }), "Serie", "several folders use what they share");

// Loose files or no folder at all say nothing
[
  "/Users/me/Downloads/01.psd",
  "/Users/me/Desktop/PSD/01.psd",
  "/Users/me/01.psd",
  "/Volumes/Disk/01.psd",
  "C:\\01.psd",
  "01.psd",
].forEach((path) => assert.strictEqual(name({ images: pages(path) }), null, path));

// The folder wins over the script
assert.strictEqual(name({ text: "Chapitre 9\nHello there my friend", images: pages("/Users/me/Desktop/105/01.psd") }), "105");

// Chapter headings, wherever the script writes them near its start
assert.strictEqual(name({ text: "Page 1\nChapitre 105 : Les secrets de Lotte\nOuah !" }), "Chapitre 105");
assert.strictEqual(name({ text: "## Chapter 12.5\nHi" }), "Chapter 12.5");
assert.strictEqual(name({ text: "**Ch. 7 - Title**\nHi" }), "Ch 7");
assert.strictEqual(name({ text: "[Capítulo 3]" }), "Capítulo 3");
assert.strictEqual(name({ text: "Глава 40" }), "Глава 40");
assert.strictEqual(name({ text: "Chapitre 3 de ma vie, tu vois ?\nA\nB" }), "Chapitre 3 de ma vie…", "dialogue is not a heading");
assert.strictEqual(name({ text: "Chapelle 3" }), null);

// First sentence: skips page markers, reactions, ignored lines and prefixes
assert.strictEqual(
  name({ text: "Page 1\nBien,\nAprès avoir passé du temps loin de l’écurie,\nSuite" }),
  "Après avoir passé du…"
);
assert.strictEqual(name({ text: "## Page 1\nBut...\\\nTiens donc...\\\nFwip\\" }), "Tiens donc...");
assert.strictEqual(
  name({ text: "## note de traduction\nCRI: Attention derrière\nA\nB" }, { ignorePrefixes: ["##"], stylePrefixes: ["CRI:"] }),
  "Attention derrière"
);
assert.strictEqual(name({ text: "**Un mot en gras**\nA\nB" }), "Un mot en gras");

// Too little to go on: a line being typed or only reactions
assert.strictEqual(name({ text: "Une première ligne bien longue" }), null);
assert.strictEqual(name({ text: "Oh !\nAh !\nEh !" }), null);
assert.strictEqual(name({ text: "", images: [] }), null);
assert.strictEqual(name({}), null);

// Default numbers fill the gaps
assert.strictEqual(getNextDefaultTabName([{ name: "Onglet 1" }, { name: "Onglet 3" }], label), "Onglet 2");
assert.strictEqual(getNextDefaultTabName([], label), "Onglet 1");

const folder = (id) => ({ id, name: "Onglet " + id, text: "", images: pages("/Users/me/Desktop/105/01.psd") });
const options = { label };

// Old tabs under a default name follow, old tabs with a chosen name do not
{
  const tabs = applyAutoTabNames(
    [
      { id: "a", name: "Onglet 3", text: "Chapitre 8\n" },
      { id: "b", name: "Tab 2", text: "Chapitre 9\n" },
      { id: "c", name: "106", text: "Chapitre 10\n" },
      { id: "d", name: "Mon onglet 4", text: "Chapitre 11\n" },
    ],
    options
  );
  assert.deepStrictEqual(tabs.map((tab) => tab.name), ["Chapitre 8", "Chapitre 9", "106", "Mon onglet 4"]);
  assert.strictEqual(tabs[0].autoName, true);
  assert.strictEqual(tabs[2].autoName, undefined);
}

// A renamed tab stays as it is, even under a name like a default one
{
  const tabs = [{ id: "a", name: "Onglet 7", autoName: false, text: "Chapitre 8\n" }];
  assert.strictEqual(applyAutoTabNames(tabs, options), tabs);
}

// The name follows the content, and comes back to a number when it is emptied
{
  let tabs = applyAutoTabNames([{ id: "a", name: "Onglet 1", text: "Chapitre 8\n" }], options);
  tabs = applyAutoTabNames([{ ...tabs[0], text: "Chapitre 9\n" }], options);
  assert.strictEqual(tabs[0].name, "Chapitre 9");
  tabs = applyAutoTabNames([{ ...tabs[0], text: "" }], options);
  assert.strictEqual(tabs[0].name, "Onglet 1");
  assert.strictEqual(tabs[0].autoName, true);
}

// An empty tab keeps its number, and nothing changes identity without a reason
{
  const tabs = [{ id: "a", name: "Onglet 3", text: "" }, { id: "b", name: "Onglet 5", text: "" }];
  assert.strictEqual(applyAutoTabNames(tabs, options), tabs);
}

// Same content, or a name the user already took: told apart, and stable
{
  const first = applyAutoTabNames([folder(1), folder(2), { id: "m", name: "105", autoName: false }], options);
  assert.deepStrictEqual(first.map((tab) => tab.name), ["105 (2)", "105 (3)", "105"]);
  assert.strictEqual(applyAutoTabNames(first, options), first, "a second pass changes nothing");
  // Closing the tab that held the name frees it
  const closed = applyAutoTabNames(first.slice(0, 2), options);
  assert.deepStrictEqual(closed.map((tab) => tab.name), ["105", "105 (2)"]);
}

// Duplicate default names from older versions are told apart
{
  const tabs = applyAutoTabNames([{ id: "a", name: "Onglet 2", text: "" }, { id: "b", name: "Onglet 2", text: "" }], options);
  assert.deepStrictEqual(tabs.map((tab) => tab.name), ["Onglet 2", "Onglet 1"]);
}

// Reducer wiring: a real rename stops the following, a named new tab never starts it
const contextSource = require("fs").readFileSync(require("path").join(__dirname, "..", "app_src", "context.jsx"), "utf8");
assert.ok(contextSource.includes("tab.name !== name ? { ...tab, name, autoName: false } : tab"), "renameTab must lock a changed name only");
assert.ok(contextSource.includes("autoName: !action.name"), "addTab must not follow content under a given name");
assert.ok(contextSource.includes("applyAutoTabNames(tabStorage.tabs, getTabNameOptions(initialState))"), "saved tabs are named at startup");
assert.ok(contextSource.includes("newState.tabs = applyAutoTabNames(newState.tabs, getTabNameOptions(newState))"), "tabs follow every change");

console.log("Tab names OK");
