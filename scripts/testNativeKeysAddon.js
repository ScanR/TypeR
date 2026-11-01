// Optional compiler check, run explicitly: npm run test:keys-addon:native.
const path = require("path");
const { execFileSync } = require("child_process");
const { compile } = require("./helpers/windowsCpp");
const root = path.resolve(__dirname, "..");
const directory = path.join(root, ".native-build/tests");
const binary = path.join(directory, "keys-addon-test.exe");
if (process.argv.includes("--compile")) {
  compile(["/nologo", "/std:c++17", "/O2", "/W4", "/WX", "/EHsc", "/MT", path.join(root, "scripts/native/keysAddonTest.cpp"), "/Fe:" + binary], directory);
  execFileSync(binary, [], { stdio: "inherit" });
} else {
  console.log("Native addon compiler tests: use npm run test:keys-addon:native (requires Windows C++ Build Tools)");
}
