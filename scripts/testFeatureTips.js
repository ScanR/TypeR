const assert = require("assert");
const babel = require("@babel/core");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(rootDir, "app_src", "featureTips.js"), "utf8");
const transformed = babel.transformSync(source, {
  presets: [["@babel/preset-env", { modules: "commonjs" }]],
}).code;
const loaded = { exports: {} };
new Function("require", "module", "exports", transformed)(require, loaded, loaded.exports);

const {
  FEATURE_TIPS,
  formatFeatureTip,
  normalizeSeenFeatureTips,
  showFeatureTip,
} = loaded.exports;

const tipIds = Object.keys(FEATURE_TIPS);
assert.ok(tipIds.includes("exportFolderFonts"), "The export folder tip must stay registered");

// A tip shows once, then stays hidden
let state = { showTips: true, seenFeatureTips: {}, activeFeatureTip: null };
const shown = showFeatureTip(state, "exportFolderFonts");
assert.strictEqual(shown.activeFeatureTip, "exportFolderFonts");
assert.deepStrictEqual(shown.seenFeatureTips, { exportFolderFonts: true });
state = { ...state, ...shown, activeFeatureTip: null };
assert.strictEqual(showFeatureTip(state, "exportFolderFonts"), null, "A seen tip must not show again");

// The toast has a single slot, next to the notice toast
const footerSource = fs.readFileSync(path.join(rootDir, "app_src/components/footer/footer.jsx"), "utf8");
assert.ok(footerSource.includes("<FeatureTip />"), "The footer must mount the tip toast");

// Tips stay hidden when disabled, unknown, or when another one is on screen
assert.strictEqual(showFeatureTip({ showTips: false }, "exportFolderFonts"), null);
assert.strictEqual(showFeatureTip({ showTips: true }, "unknownTip"), null);
const otherId = tipIds.find((id) => id !== "exportFolderFonts");
if (otherId) {
  const blocked = showFeatureTip({ showTips: true, activeFeatureTip: otherId }, "exportFolderFonts");
  assert.strictEqual(blocked.activeFeatureTip, undefined, "A new tip must not replace one that is still on screen");
  assert.strictEqual(blocked.seenFeatureTips, undefined, "A blocked tip must stay unseen so it can show later");
}

// `after` waits for the action to repeat; a modal or tour holds the tip back
const repeatedId = tipIds.find((id) => (FEATURE_TIPS[id].after || 1) > 1);
let repeated = { showTips: true };
for (let i = 1; i < FEATURE_TIPS[repeatedId].after; i += 1) {
  repeated = { ...repeated, ...showFeatureTip(repeated, repeatedId) };
  assert.strictEqual(repeated.activeFeatureTip, undefined, "A repeated-action tip must wait for its count");
}
const heldBack = showFeatureTip({ ...repeated, modalType: "whatsNew" }, repeatedId);
assert.strictEqual(heldBack.activeFeatureTip, undefined, "No tip while a modal or tour is open");
assert.strictEqual(showFeatureTip(repeated, repeatedId).activeFeatureTip, repeatedId);

// Stored data is untrusted
assert.deepStrictEqual(normalizeSeenFeatureTips(null), {});
assert.deepStrictEqual(normalizeSeenFeatureTips(["exportFolderFonts"]), {});
assert.deepStrictEqual(
  normalizeSeenFeatureTips({ exportFolderFonts: true, unknownTip: true, [otherId || "x"]: "yes" }),
  { exportFolderFonts: true }
);

// {mod} follows the platform
assert.ok(formatFeatureTip("exportFolderFonts", {}, {}, false).includes("Ctrl"));
assert.ok(formatFeatureTip("exportFolderFonts", {}, {}, true).includes("Cmd"));
assert.ok(!formatFeatureTip("exportFolderFonts", {}, {}, true).includes("{mod}"));
assert.ok(formatFeatureTip("keepSizePaste", {}, { keepSize: "Alt" }).includes("Alt"));
assert.strictEqual(formatFeatureTip("unknownTip", {}), "");

const placeholders = (text) => [...new Set(text.match(/\{\w+\}/g) || [])].sort();

// Every tip has a translation in every locale, with the same placeholders
const readLocale = (relativePath) => {
  const values = new Map();
  fs.readFileSync(path.join(rootDir, relativePath), "utf8").split(/\r?\n/).forEach((line) => {
    const match = line.match(/^([^=#]+)=(.*)$/);
    if (match) values.set(match[1], match[2]);
  });
  return values;
};
const localeFiles = ["locale/messages.properties"].concat(
  fs.readdirSync(path.join(rootDir, "locale"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `locale/${entry.name}/messages.properties`)
);
localeFiles.forEach((file) => {
  const values = readLocale(file);
  assert.ok(values.get("featureTipTitle"), `${file} is missing featureTipTitle`);
  tipIds.forEach((id) => {
    const tip = FEATURE_TIPS[id];
    const value = values.get(tip.key);
    assert.ok(value, `${file} is missing ${tip.key}`);
    assert.deepStrictEqual(placeholders(value), placeholders(tip.fallback), `${file} ${tip.key} placeholder mismatch`);
    assert.ok(!/\{\w+\}/.test(formatFeatureTip(id, Object.fromEntries(values), { keepSize: "Alt" })), `${file} ${tip.key} keeps an unfilled placeholder`);
  });
});

console.log("feature tip tests passed");
