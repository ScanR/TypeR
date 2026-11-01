const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { compile } = require("./helpers/windowsCpp");
const root = path.resolve(__dirname, "..");
const directory = path.join(root, ".native-build/win-x64");
const prebuilt = path.join(root, "uxp-src/native/addon/win-x64");
const sourceFiles = ["uxp-src/native/addon/keys.h", "uxp-src/native/addon/module.cpp", "scripts/buildKeysAddon.js", "scripts/helpers/windowsCpp.js"];
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
// The checked-in binary is packaged on macOS/Linux too. Git line-ending
// conversion must not make an unchanged source look like a different build.
const sourceHash = () => hash(Buffer.concat(sourceFiles.map((file) => Buffer.from(fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n')))));

function build() {
  const sdkRoot = process.env.UXP_HYBRID_SDK;
  if (!sdkRoot || !fs.existsSync(path.join(sdkRoot, "src/utilities/UxpAddon.h"))) {
    throw new Error("Set UXP_HYBRID_SDK to the extracted Adobe UXP Hybrid Plugin SDK folder (containing src/utilities/UxpAddon.h). Download: https://developer.adobe.com/console/servicesandapis");
  }
  const binary = path.join(directory, "typer-keys.uxpaddon");
  compile([
    "/nologo", "/std:c++17", "/O2", "/W4", "/EHsc", "/MT", "/LD", "/guard:cf", "/Brepro",
    "/I" + path.resolve(sdkRoot, "src/utilities"), "/I" + path.resolve(sdkRoot, "src/api"),
    path.join(root, "uxp-src/native/addon/module.cpp"),
    "/link", "/OUT:" + binary, "/IMPLIB:" + path.join(directory, "typer-keys.lib"),
    "/DYNAMICBASE", "/NXCOMPAT", "user32.lib",
  ], directory);
  const sdkFiles = ["src/utilities/UxpAddon.h", "src/api/UxpAddonShared.h", "src/api/UxpAddonTypes.h"];
  const receipt = { sourceHash: sourceHash(), sha256: hash(fs.readFileSync(binary)), sdkHash: hash(Buffer.concat(sdkFiles.map((file) => fs.readFileSync(path.join(sdkRoot, file))))) };
  fs.writeFileSync(path.join(directory, "build.json"), JSON.stringify(receipt, null, 2) + "\n");
  fs.mkdirSync(prebuilt, { recursive: true });
  fs.copyFileSync(binary, path.join(prebuilt, "typer-keys.uxpaddon"));
  fs.writeFileSync(path.join(prebuilt, "build.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log("Windows keyboard addon built: " + binary);
}

function verifiedBinary() {
  const binary = path.join(prebuilt, "typer-keys.uxpaddon");
  const receipt = JSON.parse(fs.readFileSync(path.join(prebuilt, "build.json"), "utf8"));
  const bytes = fs.readFileSync(binary);
  if (receipt.sourceHash !== sourceHash() || receipt.sha256 !== hash(bytes)) throw new Error("Rebuild the keyboard addon: its source or binary changed");
  // AMD64 PE DLL, not an EXE renamed to .uxpaddon.
  const pe = bytes.length >= 64 ? bytes.readUInt32LE(60) : bytes.length;
  if (pe > bytes.length - 24 || bytes.readUInt16LE(0) !== 0x5A4D || bytes.readUInt32LE(pe) !== 0x4550 ||
      bytes.readUInt16LE(pe + 4) !== 0x8664 || !(bytes.readUInt16LE(pe + 22) & 0x2000)) {
    throw new Error("The keyboard addon is not a Windows x64 DLL");
  }
  return bytes;
}

module.exports = { build, verifiedBinary };
if (require.main === module) build();
