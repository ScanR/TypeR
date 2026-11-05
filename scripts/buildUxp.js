// Finishes the UXP plugin folder (uxp/) after webpack: manifest, host page,
// locales, icons and the native keyboard reader. `--package` also writes the
// installable package: Releases/UXP-Windows.ccx, or with --mac Releases/TypeR-UXP.ccx,
// which runs on every system and replaces itself on Windows (app_src/updateLogic.js).
// The Windows package reads the keyboard with "TypeR Shortcuts.exe" (typer-keys.cs);
// --addon builds the preview package with the native addon instead.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { zipSync, unzipSync } = require("fflate");

const root = path.resolve(__dirname, "..");
const addonBuild = process.argv.includes("--addon");
const macBuild = process.argv.includes("--mac");
const out = path.join(root, macBuild ? "uxp-mac" : addonBuild ? "uxp-addon" : "uxp");
const pkg = require(path.join(root, "package.json"));
const nativeSource = path.join(root, "uxp-src/native/typer-keys.m");
const nativePacked = path.join(root, "uxp-src/native/typer-keys.json");
const windowsSources = ["typer-keys.cs", "typer-keys.csproj", "typer-keys.ico"].map((name) => path.join(root, "uxp-src/native", name));
const windowsPacked = path.join(root, "uxp-src/native/typer-keys-win.json");

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

// The macOS keyboard reader ships prebuilt (uxp-src/native/typer-keys.json),
// so the plugin builds on any system; on macOS it is rebuilt whenever its
// source changed. A .ccx may not carry a bare Mach-O, hence the base64 JSON.
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
  // Emptied first: a reader dropped from the sources must not stay in the package
  fs.rmSync(path.join(out, "native"), { recursive: true, force: true });
  fs.mkdirSync(path.join(out, "native"), { recursive: true });
  fs.writeFileSync(path.join(out, "native/typer-keys.json"), JSON.stringify({ sha256: packed.sha256, binary: packed.binary }));
}

const hasDotnet = () => {
  try {
    execFileSync("dotnet", ["--version"], { stdio: "ignore" });
    return true;
  } catch (error) {
    return false;
  }
};

// The Windows reader is a .NET Framework 4.8 Windows application
// (uxp-src/native/typer-keys.cs), shipped prebuilt in typer-keys-win.json
// and rebuilt whenever its source changed on a system with the .NET SDK
// (any OS: the reference assemblies come from NuGet).
function buildWindowsHelper() {
  const sourceHash = sha256(Buffer.concat(windowsSources.map((file) => fs.readFileSync(file))));
  let packed = null;
  try {
    packed = JSON.parse(fs.readFileSync(windowsPacked, "utf8"));
  } catch (error) {}
  if ((!packed || packed.sourceHash !== sourceHash) && hasDotnet()) {
    const work = fs.mkdtempSync(path.join(require("os").tmpdir(), "typer-keys-win-"));
    try {
      windowsSources.forEach((file) => fs.copyFileSync(file, path.join(work, path.basename(file))));
      execFileSync("dotnet", ["build", "typer-keys.csproj", "-c", "Release", "-o", "out", "-nologo", "-v", "quiet"], { cwd: work, stdio: "inherit" });
      const bytes = fs.readFileSync(path.join(work, "out/TypeR Shortcuts.exe"));
      packed = { sourceHash, sha256: sha256(bytes), binary: bytes.toString("base64") };
      fs.writeFileSync(windowsPacked, JSON.stringify(packed) + "\n");
      console.log("Windows keyboard reader rebuilt (" + bytes.length + " bytes)");
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }
  if (!packed) throw new Error("uxp-src/native/typer-keys-win.json is missing: build once with the .NET SDK");
  if (packed.sourceHash !== sourceHash) console.warn("Warning: the prebuilt Windows keyboard reader is older than typer-keys.cs");
  if (sha256(Buffer.from(packed.binary, "base64")) !== packed.sha256) throw new Error("Corrupt typer-keys-win.json");
  // Emptied first: only this reader is in the Windows package
  fs.rmSync(path.join(out, "native"), { recursive: true, force: true });
  fs.rmSync(path.join(out, "win"), { recursive: true, force: true });
  fs.mkdirSync(path.join(out, "native"), { recursive: true });
  fs.writeFileSync(path.join(out, "native/typer-keys-win.json"), JSON.stringify({ sha256: packed.sha256, binary: packed.binary }));
}

function writeManifest() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "uxp-src/manifest.json"), "utf8"));
  manifest.version = pkg.version;
  if (addonBuild) {
    manifest.manifestVersion = 6;
    manifest.addon = { name: "typer-keys.uxpaddon" };
    manifest.requiredPermissions.enableAddon = true;
  }
  if (process.argv.includes('--diagnostic')) {
    manifest.name = 'TypeR DEBUG';
    manifest.entrypoints.forEach(entry => { if (entry.id === 'typer') entry.label = { default: 'TypeR DEBUG' }; });
  }
  // Development builds evaluate test code (uxp-src/host/devChannel.js)
  if (process.argv.includes("--dev")) manifest.requiredPermissions.allowCodeGenerationFromStrings = true;
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

function copyAssets() {
  fs.copyFileSync(path.join(root, "uxp-src/index.html"), path.join(out, "index.html"));
  // The page of the WebView probes (uxp-src/host/panelProbe.js)
  if (process.argv.includes("--trace")) fs.copyFileSync(path.join(root, "uxp-src/web/probe.html"), path.join(out, "web/probe.html"));
  copyDir(path.join(root, "locale"), path.join(out, "locale"));
  // UXP resolves "icons/x.png" with scale [1, 2] as x@1x.png and x@2x.png
  fs.mkdirSync(path.join(out, "icons"), { recursive: true });
  ["iconNormal", "iconDarkNormal"].forEach((name) => {
    fs.copyFileSync(path.join(root, "icons", name + ".png"), path.join(out, "icons", name + "@1x.png"));
    fs.copyFileSync(path.join(root, "icons", name + "@2X.png"), path.join(out, "icons", name + "@2x.png"));
  });
  fs.copyFileSync(path.join(root, "LICENSE.md"), path.join(out, "LICENSE.md"));
  // Practice pages of the guided tours, opened in Photoshop
  fs.mkdirSync(path.join(out, "assets"), { recursive: true });
  fs.copyFileSync(path.join(root, "app_src/assets/typer-practice-page.png"), path.join(out, "assets/typer-practice-page.png"));
  fs.copyFileSync(path.join(root, "app_src/assets/typer-basics-page.png"), path.join(out, "assets/typer-basics-page.png"));
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
  const nativeFiles = macBuild ? ["native/typer-keys.json"] : addonBuild ? ["win/x64/typer-keys.uxpaddon"] : ["native/typer-keys-win.json"];
  ["manifest.json", "index.html", "host.js", "web/index.html", "web/index.js", "locale/messages.properties", ...nativeFiles].forEach((name) => {
    if (!files[name]) throw new Error("Incomplete UXP build: " + name);
  });
  if (addonBuild && Object.keys(files).some((name) => /^native\//.test(name) || /\.(exe|ps1)$/i.test(name))) {
    throw new Error("The addon package must not contain an external keyboard helper");
  }
  // The reader ships base64-encoded in a JSON file: a .ccx may not carry an executable
  if (!addonBuild && Object.keys(files).some((name) => /\.(exe|ps1|uxpaddon)$/i.test(name))) {
    throw new Error("The package must not contain an executable or a native addon");
  }
  if (Object.keys(files).some((name) => /\.(jsx|jsxinc)$/.test(name))) throw new Error("The UXP package must not contain ExtendScript files");
  // Creative Cloud expects the manifest as the first entry of the archive
  const ordered = { "manifest.json": files["manifest.json"] };
  Object.keys(files).filter((name) => name !== "manifest.json").forEach((name) => { ordered[name] = files[name]; });
  const zip = zipSync(ordered, { level: 9 });
  const check = unzipSync(zip, { filter: (entry) => entry.name === "manifest.json" });
  if (JSON.parse(Buffer.from(check["manifest.json"]).toString("utf8")).version !== manifest.version) throw new Error("Package check failed");
  const directory = path.join(root, "Releases");
  fs.mkdirSync(directory, { recursive: true });
  // --trace: the crash trace build (uxp-src/host/crashTrace.js), sent to a
  // user whose Photoshop crashes
  const suffix = process.argv.includes('--diagnostic') ? '-debug' : process.argv.includes('--dev') ? '-dev' : process.argv.includes('--trace') ? '-trace' : '';
  const name = addonBuild ? "TypeR-UXP-addon-win.ccx"
    : suffix ? 'TypeR-UXP' + (macBuild ? '-mac' : '') + suffix + '.ccx'
    : macBuild ? 'TypeR-UXP.ccx' : 'UXP-Windows.ccx';
  const target = path.join(directory, name);
  fs.writeFileSync(target, zip);
  fs.writeFileSync(target + ".sha256", sha256(zip) + "  " + name + "\n");
  console.log("UXP package ready: Releases/" + name + " (" + zip.length + " bytes)");
}

if (!fs.existsSync(path.join(out, "host.js")) || !fs.existsSync(path.join(out, "web/index.js"))) {
  throw new Error("Run webpack with webpack.uxp.config.js first");
}
const diagnosticBuild = process.argv.includes('--diagnostic');
if (macBuild && addonBuild) throw new Error('Choose either macOS or Windows addon packaging');
if (addonBuild && (diagnosticBuild || process.argv.includes('--dev') || process.argv.includes('--trace'))) throw new Error('Build the Windows addon preview separately');
const addonHost = fs.readFileSync(path.join(out, 'host.js'), 'utf8').includes('TypeR UXP addon reader v1');
if (addonBuild !== addonHost) throw new Error('UXP addon build mode mismatch: use matching --env addon / --addon flags');
const windowsHost = /WINDOWS_PACKAGE =\s*true && true;/.test(fs.readFileSync(path.join(out, 'host.js'), 'utf8'));
if ((!macBuild && !addonBuild) !== windowsHost) throw new Error('UXP build mode mismatch: rebuild the host with matching --env mac / --mac flags');
if (diagnosticBuild && (process.argv.includes('--dev') || process.argv.includes('--trace'))) throw new Error('Choose one UXP diagnostic, developer, or trace build');
const diagnosticHost = fs.readFileSync(path.join(out, 'host.js'), 'utf8').includes('TypeR startup diagnostic v1');
const diagnosticPanel = fs.readFileSync(path.join(out, 'web/index.html'), 'utf8').includes('html.script');
if (diagnosticBuild !== diagnosticHost || diagnosticBuild !== diagnosticPanel) throw new Error('UXP build mode mismatch: rebuild both host and panel with matching --env diagnostic / --diagnostic flags');
const manifest = writeManifest();
const debugMarker = path.join(out, 'typer-debug-build.json');
if (process.argv.includes('--diagnostic')) {
  fs.writeFileSync(debugMarker, JSON.stringify({ build: 'startup-debug', version: pkg.version, builtAt: new Date().toISOString(), hostSha256: sha256(fs.readFileSync(path.join(out, 'host.js'))), panelSha256: sha256(fs.readFileSync(path.join(out, 'web/index.js'))) }, null, 2));
} else if (fs.existsSync(debugMarker)) fs.unlinkSync(debugMarker);
copyAssets();
if (!macBuild && !addonBuild) {
  buildWindowsHelper();
} else if (addonBuild) {
  const bytes = require('./buildKeysAddon').verifiedBinary();
  // out is one of the fixed build directories above, never a user path.
  fs.rmSync(path.join(out, 'native'), { recursive: true, force: true });
  const nativeDirectory = path.join(out, 'win/x64');
  fs.mkdirSync(nativeDirectory, { recursive: true });
  fs.writeFileSync(path.join(nativeDirectory, 'typer-keys.uxpaddon'), bytes);
} else {
  fs.rmSync(path.join(out, 'win'), { recursive: true, force: true });
  buildNativeHelper();
}
console.log("UXP plugin built in " + path.basename(out) + "/ (" + manifest.id + " " + manifest.version + ")");
if (process.argv.includes("--package")) packageCcx(manifest);
