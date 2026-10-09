// Finishes the UXP plugin folder (uxp/) after webpack: manifest, host page,
// locales, icons and the native keyboard reader. `--package` also writes the
// installable Releases/TypeR-UXP.ccx.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { zipSync, unzipSync } = require("fflate");

const root = path.resolve(__dirname, "..");
const out = path.join(root, "uxp");
const pkg = require(path.join(root, "package.json"));
const nativeSource = path.join(root, "uxp-src/native/typer-keys.m");
const nativePacked = path.join(root, "uxp-src/native/typer-keys.json");

const copyDir = (from, to) => {
  fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from).forEach((name) => {
    const source = path.join(from, name);
    const target = path.join(to, name);
    if (fs.statSync(source).isDirectory()) copyDir(source, target);
    else fs.copyFileSync(source, target);
  });
};

const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");

// The keyboard reader ships prebuilt (uxp-src/native/typer-keys.json), so the
// plugin builds on any system; on macOS it is rebuilt whenever its source
// changed. A .ccx may not carry a bare Mach-O, hence the base64 JSON.
function buildNativeHelper() {
  const sourceHash = sha256(fs.readFileSync(nativeSource));
  let packed = null;
  try {
    packed = JSON.parse(fs.readFileSync(nativePacked, "utf8"));
  } catch (error) {}
  if (process.platform === "darwin" && (!packed || packed.sourceHash !== sourceHash)) {
    const binary = path.join(require("os").tmpdir(), "typer-keys-" + process.pid);
    execFileSync("clang", [
      "-Os", "-arch", "arm64", "-arch", "x86_64", "-mmacosx-version-min=11.0", "-fobjc-arc",
      "-framework", "Cocoa", "-framework", "Carbon", "-framework", "CoreGraphics",
      nativeSource, "-o", binary,
    ], { stdio: "inherit" });
    const bytes = fs.readFileSync(binary);
    fs.unlinkSync(binary);
    packed = { sourceHash, sha256: sha256(bytes), binary: bytes.toString("base64") };
    fs.writeFileSync(nativePacked, JSON.stringify(packed) + "\n");
    console.log("Native keyboard reader rebuilt (" + bytes.length + " bytes)");
  }
  if (!packed) throw new Error("uxp-src/native/typer-keys.json is missing: build once on macOS");
  if (packed.sourceHash !== sourceHash) console.warn("Warning: the prebuilt keyboard reader is older than typer-keys.m");
  if (sha256(Buffer.from(packed.binary, "base64")) !== packed.sha256) throw new Error("Corrupt typer-keys.json");
  fs.mkdirSync(path.join(out, "native"), { recursive: true });
  fs.writeFileSync(path.join(out, "native/typer-keys.json"), JSON.stringify({ sha256: packed.sha256, binary: packed.binary }));
  fs.copyFileSync(path.join(root, "uxp-src/native/typer-keys.ps1"), path.join(out, "native/typer-keys.ps1"));
}

function writeManifest() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "uxp-src/manifest.json"), "utf8"));
  manifest.version = pkg.version;
  // Development builds evaluate test code (uxp-src/host/devChannel.js)
  if (process.argv.includes("--dev")) manifest.requiredPermissions.allowCodeGenerationFromStrings = true;
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

function copyAssets() {
  fs.copyFileSync(path.join(root, "uxp-src/index.html"), path.join(out, "index.html"));
  copyDir(path.join(root, "locale"), path.join(out, "locale"));
  // UXP resolves "icons/x.png" with scale [1, 2] as x@1x.png and x@2x.png
  fs.mkdirSync(path.join(out, "icons"), { recursive: true });
  ["iconNormal", "iconDarkNormal"].forEach((name) => {
    fs.copyFileSync(path.join(root, "icons", name + ".png"), path.join(out, "icons", name + "@1x.png"));
    fs.copyFileSync(path.join(root, "icons", name + "@2X.png"), path.join(out, "icons", name + "@2x.png"));
  });
  fs.copyFileSync(path.join(root, "LICENSE.md"), path.join(out, "LICENSE.md"));
}

function packageCcx(manifest) {
  const files = {};
  const walk = (relative) => {
    const absolute = path.join(out, relative);
    if (fs.lstatSync(absolute).isSymbolicLink()) throw new Error("Symlink in package: " + relative);
    if (fs.statSync(absolute).isDirectory()) fs.readdirSync(absolute).sort().forEach((name) => walk(relative ? relative + "/" + name : name));
    else if (!/(^|\/)\.DS_Store$|^host-test\.js$|\.map$/.test(relative)) files[relative] = fs.readFileSync(absolute);
  };
  walk("");
  ["manifest.json", "index.html", "host.js", "web/index.html", "web/index.js", "native/typer-keys.json", "locale/messages.properties"].forEach((name) => {
    if (!files[name]) throw new Error("Incomplete UXP build: " + name);
  });
  if (Object.keys(files).some((name) => /\.(jsx|jsxinc)$/.test(name))) throw new Error("The UXP package must not contain ExtendScript files");
  // Creative Cloud expects the manifest as the first entry of the archive
  const ordered = { "manifest.json": files["manifest.json"] };
  Object.keys(files).filter((name) => name !== "manifest.json").forEach((name) => { ordered[name] = files[name]; });
  const zip = zipSync(ordered, { level: 9 });
  const check = unzipSync(zip, { filter: (entry) => entry.name === "manifest.json" });
  if (JSON.parse(Buffer.from(check["manifest.json"]).toString("utf8")).version !== manifest.version) throw new Error("Package check failed");
  const directory = path.join(root, "Releases");
  fs.mkdirSync(directory, { recursive: true });
  const name = process.argv.includes("--dev") ? "TypeR-UXP-dev.ccx" : "TypeR-UXP.ccx";
  const target = path.join(directory, name);
  fs.writeFileSync(target, zip);
  fs.writeFileSync(target + ".sha256", sha256(zip) + "  " + name + "\n");
  console.log("UXP package ready: Releases/" + name + " (" + zip.length + " bytes)");
}

if (!fs.existsSync(path.join(out, "host.js")) || !fs.existsSync(path.join(out, "web/index.js"))) {
  throw new Error("Run webpack with webpack.uxp.config.js first");
}
const manifest = writeManifest();
copyAssets();
buildNativeHelper();
console.log("UXP plugin built in uxp/ (" + manifest.id + " " + manifest.version + ")");
if (process.argv.includes("--package")) packageCcx(manifest);
