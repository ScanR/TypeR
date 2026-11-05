// Shortcut field in the new TypeR: Photoshop keeps every key pressed with Ctrl
// from the panel's WebView2, so the field records the keyboard reader's states
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const load = require("./helpers/loadAppModule")();
const { createHostShortcutRecorder, parseHostKeys } = load("app_src/shortcutRecorder.js");

const press = (recorder, states) => states.map((state) => recorder.update(state)).filter(Boolean);

assert.deepStrictEqual(parseHostKeys("aCTRLaLEFTaARROWLEFTa"), ["CTRL", "LEFT"], "aliases of a key are dropped");
assert.deepStrictEqual(parseHostKeys("a"), []);
assert.deepStrictEqual(parseHostKeys("junk"), []);

// Ctrl alone, released: recorded (the DOM never sees it)
let recorder = createHostShortcutRecorder();
assert.deepStrictEqual(press(recorder, ["aCTRLa", "a"]), [["CTRL"]]);

// Ctrl+Win in any press and release order: one chord, in the stored order
recorder = createHostShortcutRecorder();
assert.deepStrictEqual(press(recorder, ["aCTRLa", "aWINaCTRLa", "aWINa", "a"]), [["WIN", "CTRL"]]);

// Ctrl+K: modifiers then the main key
recorder = createHostShortcutRecorder();
assert.deepStrictEqual(press(recorder, ["aCTRLa", "aCTRLaKa", "aCTRLa", "a"]), [["CTRL", "K"]]);

// Only the first main key counts
recorder = createHostShortcutRecorder();
assert.deepStrictEqual(press(recorder, ["aSHIFTaKa", "aSHIFTaJa", "a"]), [["SHIFT", "K"]]);

// A second press starts over
recorder = createHostShortcutRecorder();
assert.deepStrictEqual(press(recorder, ["aALTa", "a", "aCTRLa", "a"]), [["ALT"], ["CTRL"]]);

// Repeated releases record nothing more
recorder = createHostShortcutRecorder();
assert.deepStrictEqual(press(recorder, ["a", "a"]), []);

// Modifier-only fields (keep text size) keep the modifiers, ignore a lone key
recorder = createHostShortcutRecorder({ modifierOnly: true });
assert.deepStrictEqual(press(recorder, ["aCTRLaKa", "a", "aKa", "a"]), [["CTRL"]]);

// The field listens to the reader only while it records, through a ref so a
// settings re-render does not restart a press
const fieldSource = fs.readFileSync(path.join(__dirname, "..", "app_src", "components", "modal", "shortCut.jsx"), "utf8");
assert(/host\.onKeys\(/.test(fieldSource), "the shortcut field listens to the keyboard reader");
assert(/\}, \[recording, props\.modifierOnly\]\);/.test(fieldSource), "the reader subscription only follows recording");

console.log("shortcut recorder tests passed");
