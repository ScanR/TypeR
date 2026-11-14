const assert = require("assert");
const fs = require("fs");
const path = require("path");
const load = require("./helpers/loadAppModule")();

// The panel's layout follows its interface language, not the text direction
// (typer-support, 2026-11-14: an English panel flipped with Arabic text)
const { getInterfaceDirection } = load("app_src/interfaceLanguage.js");
global.window = global.window || {};
const withHostLocale = (locale, run) => {
  const previous = window.__adobe_cep__;
  window.__adobe_cep__ = { getHostEnvironment: () => JSON.stringify({ appUILocale: locale }) };
  try { run(); } finally { window.__adobe_cep__ = previous; }
};
withHostLocale("en_US", () => {
  assert.strictEqual(getInterfaceDirection({ language: "auto", direction: "rtl" }), "ltr");
  assert.strictEqual(getInterfaceDirection({ language: "en_US", direction: "rtl" }), "ltr");
  assert.strictEqual(getInterfaceDirection({ language: "fr_FR", direction: "rtl" }), "ltr");
  assert.strictEqual(getInterfaceDirection({ language: "ar_AE", direction: "ltr" }), "rtl");
});
withHostLocale("ar_AE", () => {
  assert.strictEqual(getInterfaceDirection({ language: "auto", direction: "ltr" }), "rtl");
  assert.strictEqual(getInterfaceDirection({ language: "en_US", direction: "rtl" }), "ltr");
});

const context = fs.readFileSync(path.join(__dirname, "..", "app_src/context.jsx"), "utf8");
assert(/getInterfaceDirection\(state\)/.test(context));
assert(!/setAttribute\("dir", state\.direction/.test(context));

console.log("interface direction tests passed");
