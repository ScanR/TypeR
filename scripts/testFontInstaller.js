const assert = require("assert");
const babel = require("@babel/core");
const fs = require("fs");
const path = require("path");

global.window = {};
global.navigator = { platform: "Win32" };
const source = fs.readFileSync(path.resolve(__dirname, "../app_src/fontInstaller.js"), "utf8");
const transformed = babel.transformSync(source, {
  presets: [["@babel/preset-env", { modules: "commonjs", targets: { node: "current" } }]],
}).code;
const installerModule = { exports: {} };
new Function("require", "module", "exports", transformed)(name => name === "./nodeCompat" ? require("./helpers/loadAppModule")()("app_src/nodeCompat.js") : require(name), installerModule, installerModule.exports);
const {
  FONT_REGISTRY_PATH,
  buildWindowsRegistrationScript,
  getInstallDir,
  psSingleQuote,
  registryFontType,
  registryValueName,
} = installerModule.exports;

assert.strictEqual(registryFontType("AnimeAce.otf"), "OpenType");
assert.strictEqual(registryFontType("AnimeAce.OTF"), "OpenType");
assert.strictEqual(registryFontType("AnimeAce.ttf"), "TrueType");
assert.strictEqual(registryFontType("AnimeAce.ttc"), "TrueType");

assert.strictEqual(registryValueName("Anime Ace 2.0 BB", "animeace2.otf"), "Anime Ace 2.0 BB (OpenType)");
assert.strictEqual(registryValueName("", "fallback.ttf"), "fallback.ttf (TrueType)");
assert.strictEqual(registryValueName("Bad\u0000Name", "x.ttf"), "Bad Name (TrueType)");

assert.strictEqual(psSingleQuote("O'Brien"), "'O''Brien'");

const script = buildWindowsRegistrationScript([
  { registryName: "Wild Words (TrueType)", path: "C:\\Fonts\\wild'words.ttf" },
]);
assert(script.includes(FONT_REGISTRY_PATH), "script must target the HKCU Fonts key");
assert(script.includes("'Wild Words (TrueType)'"), "registry value name must be quoted");
assert(script.includes("'C:\\Fonts\\wild''words.ttf'"), "single quotes in paths must be escaped");
assert(script.includes("AddFontResource"), "script must load the font resource");
assert(script.includes("0x1D"), "script must broadcast WM_FONTCHANGE");
assert(!script.includes("\n"), "encoded command scripts must stay single-line");

const fakeRequire = (name) => {
  if (name === "path") return { join: (...parts) => parts.join("\\") };
  if (name === "os") return { homedir: () => "C:\\Users\\Test" };
  if (name === "process") return { env: { LOCALAPPDATA: "C:\\Users\\Test\\AppData\\Local" } };
  throw new Error(`unexpected require: ${name}`);
};
assert.strictEqual(
  getInstallDir(fakeRequire, "win"),
  "C:\\Users\\Test\\AppData\\Local\\Microsoft\\Windows\\Fonts"
);
const noEnvRequire = (name) => {
  if (name === "path") return { join: (...parts) => parts.join("\\") };
  if (name === "os") return { homedir: () => "C:\\Users\\Test" };
  if (name === "process") throw new Error("no process module");
  throw new Error(`unexpected require: ${name}`);
};
assert.strictEqual(
  getInstallDir(noEnvRequire, "win"),
  "C:\\Users\\Test\\AppData\\Local\\Microsoft\\Windows\\Fonts"
);
const macRequire = (name) => {
  if (name === "path") return { join: (...parts) => parts.join("/") };
  if (name === "os") return { homedir: () => "/Users/test" };
  throw new Error(`unexpected require: ${name}`);
};
assert.strictEqual(getInstallDir(macRequire, "mac"), "/Users/test/Library/Fonts");

console.log("font installer tests passed");
