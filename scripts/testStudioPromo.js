const assert = require("assert");
const babel = require("@babel/core");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(rootDir, "app_src", "studioPromo.js"), "utf8");
const transformed = babel.transformSync(source, {
  presets: [["@babel/preset-env", { modules: "commonjs" }]],
}).code;
const loaded = { exports: {} };
new Function("require", "module", "exports", transformed)(require, loaded, loaded.exports);

const {
  STUDIO_PROMO_REMIND_MS,
  closeStudioPromo,
  parseStudioPromo,
  shouldShowStudioPromo,
} = loaded.exports;

// The site's switch: off unless it is plainly on
assert.deepStrictEqual(parseStudioPromo({ studioPromo: { enabled: true, id: 1 } }), { id: 1 });
assert.deepStrictEqual(parseStudioPromo('{"studioPromo":{"enabled":true,"id":2}}'), { id: 2 });
assert.strictEqual(parseStudioPromo({ studioPromo: { enabled: false, id: 1 } }), null, "off");
assert.strictEqual(parseStudioPromo({ studioPromo: { enabled: "true", id: 1 } }), null, "only true turns it on");
assert.strictEqual(parseStudioPromo({ studioPromo: { enabled: true } }), null, "an announcement needs an id");
assert.strictEqual(parseStudioPromo({ studioPromo: { enabled: true, id: 0 } }), null);
assert.strictEqual(parseStudioPromo({ studioPromo: { enabled: true, id: 1.5 } }), null);
assert.strictEqual(parseStudioPromo({ studioPromo: { enabled: true, id: "1" } }), null);
assert.strictEqual(parseStudioPromo("<html>404</html>"), null, "a page that is not the file");
assert.strictEqual(parseStudioPromo(null), null);
assert.strictEqual(parseStudioPromo([]), null);

const promo = { id: 1 };
const now = 1000000;

// Shown once per announcement
assert.strictEqual(shouldShowStudioPromo({ promo, record: undefined, off: undefined, now }), true, "never answered");
assert.strictEqual(shouldShowStudioPromo({ promo: null, record: undefined, off: undefined, now }), false, "switched off");
assert.strictEqual(shouldShowStudioPromo({ promo, record: undefined, off: true, now }), false, "Don't show again");
assert.strictEqual(shouldShowStudioPromo({ promo, record: { id: 1, remindAt: null }, now }), false, "answered");
assert.strictEqual(shouldShowStudioPromo({ promo: { id: 2 }, record: { id: 1, remindAt: null }, now }), true, "a new announcement");
assert.strictEqual(shouldShowStudioPromo({ promo, record: "garbage", now }), true, "an unreadable answer counts as none");

// "Later" asks again once, a week on
const later = closeStudioPromo({ promo, record: undefined, later: true, now });
assert.deepStrictEqual(later, { id: 1, remindAt: now + STUDIO_PROMO_REMIND_MS });
assert.strictEqual(shouldShowStudioPromo({ promo, record: later, now: now + 1000 }), false, "not the next day");
assert.strictEqual(shouldShowStudioPromo({ promo, record: later, now: now + STUDIO_PROMO_REMIND_MS }), true, "a week later");
const laterAgain = closeStudioPromo({ promo, record: later, later: true, now: now + STUDIO_PROMO_REMIND_MS });
assert.deepStrictEqual(laterAgain, { id: 1, remindAt: null }, "the second Later ends it");
assert.strictEqual(shouldShowStudioPromo({ promo, record: laterAgain, now: now + 10 * STUDIO_PROMO_REMIND_MS }), false);

// Opening Studio ends it at once
assert.deepStrictEqual(closeStudioPromo({ promo, record: undefined, later: false, now }), { id: 1, remindAt: null });
// A later answered after an older announcement starts afresh
assert.deepStrictEqual(
  closeStudioPromo({ promo: { id: 2 }, record: { id: 1, remindAt: null }, later: true, now }),
  { id: 2, remindAt: now + STUDIO_PROMO_REMIND_MS }
);

console.log("Studio promo tests passed");
