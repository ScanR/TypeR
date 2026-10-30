const assert = require("assert");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const utilsSource = fs.readFileSync(path.join(rootDir, "app_src", "utils.js"), "utf8");
const hotkeySource = fs.readFileSync(path.join(rootDir, "app_src", "hotkeys.jsx"), "utf8");
const editorSource = fs.readFileSync(path.join(rootDir, "app_src", "components", "modal", "shortCut.jsx"), "utf8");
const commandSource = fs.readFileSync(path.join(rootDir, "app_src", "shortcutCommands.js"), "utf8");
const helpSource = fs.readFileSync(path.join(rootDir, "app_src", "components", "modal", "help.jsx"), "utf8");

const slice = (source, startMarker, endMarker, label) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + 1);
  assert(start !== -1 && end !== -1, `Could not extract ${label}`);
  return source.slice(start, end);
};

// --- the generated PowerShell watcher -------------------------------------

const psMatch = utilsSource.match(/const psScript = (\[[\s\S]*?\])\.join\(" "\);/);
assert(psMatch, "psScript array not found in utils.js");
const psScript = eval(psMatch[1]).join(" ");

assert(/GetAsyncKeyState/.test(psScript), "Watcher must read key state to see the mouse side buttons");
assert(/foreach \(\$b in 5, 6\)/.test(psScript), "Watcher must poll XBUTTON1 (5) and XBUTTON2 (6)");
assert(/\[void\]\[FW\]::GetAsyncKeyState\(5\); \[void\]\[FW\]::GetAsyncKeyState\(6\);/.test(psScript),
  "The press-since-last-call bit must be primed so a stale click is not replayed at startup");
assert(/-band 1\) -ne 0/.test(psScript), "Presses must be edge-detected, not level-detected");
assert(/'MB\|'/.test(psScript) && /'FG\|'/.test(psScript), "Watcher must tag both line kinds");
assert(/\$n -eq ''/.test(psScript), "An empty process name must be retried or the foreground gate can wedge shut");
const opens = (psScript.match(/\{/g) || []).length;
const closes = (psScript.match(/\}/g) || []).length;
assert.strictEqual(opens, closes, "Generated PowerShell has unbalanced braces");

// --- watcher line parsing --------------------------------------------------

const watcherBlock = slice(utilsSource, "const mouseShortcutListeners", "const startForegroundWatcher", "watcher bridge");
const activity = [];
const foregroundWatcher = { name: "", time: 0 };
const bridge = new Function(
  "foregroundWatcher",
  "notePanelActivity",
  `${watcherBlock}\nreturn { onMouseShortcut, handleWatcherLine };`
)(foregroundWatcher, () => activity.push("activity"));

const seen = [];
bridge.onMouseShortcut((keys) => seen.push(keys));

bridge.handleWatcherLine("MB|5||Photoshop");
assert.deepStrictEqual(seen.shift(), ["MOUSE4"], "XBUTTON1 must map to MOUSE4");
bridge.handleWatcherLine("MB|6||Photoshop");
assert.deepStrictEqual(seen.shift(), ["MOUSE5"], "XBUTTON2 must map to MOUSE5");
bridge.handleWatcherLine("MB|5|WCAS|Photoshop");
assert.deepStrictEqual(seen.shift(), ["WIN", "CTRL", "ALT", "SHIFT", "MOUSE4"],
  "Modifiers must be reported in the same order the settings recorder stores them");
assert(activity.length > 0, "A side-button press is panel activity and must lift idle backoff");

bridge.handleWatcherLine("MB|5||chrome");
bridge.handleWatcherLine("MB|5||");
assert.deepStrictEqual(seen, [], "Presses outside Photoshop must be ignored");

bridge.handleWatcherLine("FG|Photoshop");
assert.strictEqual(foregroundWatcher.name, "Photoshop", "FG lines must still feed the foreground gate");
assert(foregroundWatcher.time > 0, "FG lines must refresh the freshness stamp");
bridge.handleWatcherLine("Photoshop");
assert.strictEqual(foregroundWatcher.name, "Photoshop", "A bare process name must remain understood");

// --- runtime matching ------------------------------------------------------

const matchBlock = slice(hotkeySource, "const MODIFIER_KEYS", "const isFormFieldActive", "hotkey matching");
const commands = [
  { id: "add" },
  { id: "next" },
  { id: "center" },
  { id: "nextPage" },
];
const matching = new Function(
  "shortcutCommands",
  `${matchBlock}\nreturn { matchBinding, matchMouseBinding };`
)(commands);

const shortcut = {
  add: ["WIN", "CTRL"],
  next: ["MOUSE4"],
  center: ["CTRL", "MOUSE4"],
  nextPage: ["MOUSE5"],
};

assert.strictEqual(matching.matchMouseBinding(["MOUSE4"], shortcut).id, "next");
assert.strictEqual(matching.matchMouseBinding(["CTRL", "MOUSE4"], shortcut).id, "center",
  "The most specific mouse binding must win over the bare button");
assert.strictEqual(matching.matchMouseBinding(["MOUSE5"], shortcut).id, "nextPage");
assert.strictEqual(matching.matchMouseBinding(["WIN", "CTRL", "MOUSE5"], shortcut).id, "nextPage",
  "Held modifiers must not steal a click for a keyboard-only binding");
assert.strictEqual(matching.matchMouseBinding(["WIN", "CTRL"], shortcut), null,
  "A keyboard-only binding must never fire through the mouse path");

// The keyboard poll never sees a mouse token, so mouse bindings must be inert there
assert.strictEqual(matching.matchBinding(["CTRL"], shortcut, false), null,
  "A mouse binding must not be reachable from the keyboard poll");
assert.strictEqual(matching.matchBinding(["WIN", "CTRL"], shortcut, true).id, "add",
  "Keyboard matching must keep working unchanged");

// --- recording and labels --------------------------------------------------

assert(/MOUSE_BUTTON_KEYS = \{ 3: "MOUSE4", 4: "MOUSE5" \}/.test(editorSource),
  "The settings recorder must map the DOM side buttons to the stored names");
assert(/onMouseDown=\{changeShortCutFromMouse\}/.test(editorSource),
  "The shortcut row must capture side-button presses while recording");
assert(/if \(!mouseKey \|\| !recording\) return;/.test(editorSource),
  "Side buttons must only be captured while the row is recording");

[
  ["shortcutCommands.js", commandSource],
  ["shortCut.jsx", editorSource],
  ["help.jsx", helpSource],
].forEach(([name, source]) => {
  assert(/MOUSE4:\s*['"]Mouse 4['"]/.test(source) && /MOUSE5:\s*['"]Mouse 5['"]/.test(source),
    `${name} must label the mouse side buttons`);
});

assert(/startForegroundWatcher\(\);/.test(hotkeySource),
  "Mouse bindings must not depend on the hotkey poll to start the watcher");
assert(/e\.button === 3 \|\| e\.button === 4/.test(hotkeySource),
  "CEF history navigation must be suppressed for the side buttons");

console.log("mouse shortcut tests passed");
