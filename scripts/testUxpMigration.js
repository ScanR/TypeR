// Switch from the Legacy (CEP) panel to TypeR UXP (app_src/uxpMigration.js):
// who is offered the switch, the package checks, the installer call and the
// local test mode.
const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { strToU8, zipSync } = require("fflate");
const load = require("./helpers/loadAppModule")();
const migration = load("app_src/uxpMigration.js");
const manual = load("app_src/uxpManualInstall.js");
const panelName = load("app_src/legacyPanelName.js");
const { parseUpdateTestConfig } = load("app_src/updateTestMode.js");

const ccx = (manifest) => zipSync({ "manifest.json": strToU8(JSON.stringify(manifest)), "index.html": strToU8("<html>" + "x".repeat(200) + "</html>") });
const typerPackage = ccx({ id: "com.scanr.typer", version: "3.0.0" });

(async () => {
  // Photoshop versions
  assert.strictEqual(migration.photoshopMajor("27.7.0"), 27);
  assert.strictEqual(migration.photoshopMajor("26.0"), 26);
  assert.strictEqual(migration.photoshopMajor(""), 0);
  assert.strictEqual(migration.photoshopMajor(undefined), 0);

  // Eligibility
  const ok = { isUxpPanel: false, appVersion: "26.0.0", uxpInstalled: false };
  assert.strictEqual(migration.uxpMigrationEligibility(ok), "ok");
  assert.strictEqual(migration.uxpMigrationEligibility({ ...ok, isUxpPanel: true }), "uxp");
  assert.strictEqual(migration.uxpMigrationEligibility({ ...ok, appVersion: "25.12.0" }), "photoshop", "Photoshop 2024 stays on Legacy");
  assert.strictEqual(migration.uxpMigrationEligibility({ ...ok, uxpInstalled: true }), "installed");
  assert.strictEqual(migration.uxpMigrationEligibility({ ...ok, installerAvailable: false }), "ok", "no Creative Cloud: installed by hand");

  // When the offer opens by itself
  const now = 1000000;
  const base = { eligibility: "ok", record: null, now, notFirstTime: true, checkUpdates: true, force: false };
  assert.strictEqual(migration.shouldOfferUxpMigration(base), true);
  assert.strictEqual(migration.shouldOfferUxpMigration({ ...base, notFirstTime: false }), false, "a new user just chose an edition");
  assert.strictEqual(migration.shouldOfferUxpMigration({ ...base, checkUpdates: false }), false);
  assert.strictEqual(migration.shouldOfferUxpMigration({ ...base, eligibility: "installed" }), false);
  assert.strictEqual(migration.shouldOfferUxpMigration({ ...base, record: migration.declinedUxpMigration() }), false);
  const snoozed = migration.snoozedUxpMigration(now);
  assert.strictEqual(migration.shouldOfferUxpMigration({ ...base, record: snoozed }), false, "Later waits a week");
  assert.strictEqual(migration.shouldOfferUxpMigration({ ...base, record: snoozed, now: now + migration.UXP_MIGRATION_SNOOZE_MS + 1 }), true);
  assert.strictEqual(migration.shouldOfferUxpMigration({ ...base, eligibility: "installed", notFirstTime: false, force: true }), true, "the test mode forces it");

  // The notice of the Legacy panel once TypeR UXP is installed
  const noticeBase = { eligibility: "installed", hidden: undefined, force: false };
  assert.strictEqual(migration.shouldShowUxpInstalledNotice(noticeBase), true);
  assert.strictEqual(migration.shouldShowUxpInstalledNotice({ ...noticeBase, hidden: true }), false, "Don't show again");
  assert.strictEqual(migration.shouldShowUxpInstalledNotice({ ...noticeBase, force: true }), false, "the test mode shows the offer");
  ["ok", "photoshop", "uxp"].forEach((eligibility) => {
    assert.strictEqual(migration.shouldShowUxpInstalledNotice({ ...noticeBase, eligibility }), false, eligibility);
  });

  // What opens first: the guide comes before the walkthrough and What's new
  const guideBase = { eligibility: "installed", forced: false, noticeHidden: undefined, record: null, now, notFirstTime: true, checkUpdates: true };
  assert.deepStrictEqual(migration.startupUxpGuide(guideBase), { forced: false, notice: true });
  assert.deepStrictEqual(migration.startupUxpGuide({ ...guideBase, notFirstTime: false, checkUpdates: false }), { forced: false, notice: true }, "the notice is for everyone");
  assert.strictEqual(migration.startupUxpGuide({ ...guideBase, noticeHidden: true }), null);
  assert.deepStrictEqual(migration.startupUxpGuide({ ...guideBase, eligibility: "ok" }), { forced: false, notice: false });
  assert.strictEqual(migration.startupUxpGuide({ ...guideBase, eligibility: "ok", notFirstTime: false }), null, "a new user just chose an edition");
  assert.strictEqual(migration.startupUxpGuide({ ...guideBase, eligibility: "photoshop" }), null);
  assert.strictEqual(migration.startupUxpGuide({ ...guideBase, eligibility: "uxp" }), null, "never in the UXP panel");
  assert.deepStrictEqual(migration.startupUxpGuide({ ...guideBase, eligibility: "ok", forced: true, notFirstTime: false }), { forced: true, notice: false });
  const modalSource = fs.readFileSync(path.resolve(__dirname, "../app_src/components/modal/modal.jsx"), "utf8");
  assert.ok(/if \(guide\) \{[\s\S]*?modal: 'uxpMigration'[\s\S]*?\} else \{\s*openStartWindow\(\);/.test(modalSource), "What's new waits for the guide");
  assert.ok(modalSource.indexOf("uxpGuideOpen.current = false") < modalSource.indexOf("uxpGuideOpen.current = true"), "the handover effect runs before the guide opens");

  // The Legacy panel's name in Photoshop: the real manifest, with its line endings
  const packagedManifest = fs.readFileSync(path.resolve(__dirname, "../CSXS/manifest.xml"), "utf8");
  assert.ok(packagedManifest.includes("<Menu>TypeR</Menu>"), "the package keeps the plain name");
  const oldManifest = panelName.legacyManifestWithName(packagedManifest, true);
  assert.strictEqual(oldManifest, packagedManifest.replace("<Menu>TypeR</Menu>", "<Menu>TypeR (old)</Menu>"));
  assert.strictEqual(panelName.legacyManifestWithName(oldManifest, true), oldManifest, "nothing to write the second time");
  assert.strictEqual(panelName.legacyManifestWithName(oldManifest, false), packagedManifest, "a removed plugin gives the name back");
  assert.strictEqual(panelName.legacyManifestWithName("<Menu>Other</Menu>", true), "<Menu>Other</Menu>");

  const nameSandbox = fs.mkdtempSync(path.join(os.tmpdir(), "typer-legacy-name-"));
  const nameHome = path.join(nameSandbox, "home");
  const nameRoot = path.join(nameSandbox, "typertools");
  const installedManifest = path.join(nameRoot, "CSXS", "manifest.xml");
  fs.mkdirSync(path.dirname(installedManifest), { recursive: true });
  fs.writeFileSync(installedManifest, packagedManifest);
  const nameNode = { fs, os: { platform: () => "darwin", homedir: () => nameHome }, path, env: {} };
  assert.strictEqual(migration.syncLegacyPanelName(nameNode, nameRoot), false, "no plugin: the name stays");
  const nameExternal = path.join(nameHome, "Library", "Application Support", "Adobe", "UXP", "Plugins", "External");
  fs.mkdirSync(path.join(nameExternal, "com.scanr.typer_3.0.0"), { recursive: true });
  assert.strictEqual(migration.syncLegacyPanelName(nameNode, nameRoot), true);
  assert.strictEqual(fs.readFileSync(installedManifest, "utf8"), oldManifest);
  assert.strictEqual(migration.syncLegacyPanelName(nameNode, nameRoot), false, "already renamed");
  fs.rmSync(path.join(nameExternal, "com.scanr.typer_3.0.0"), { recursive: true });
  assert.strictEqual(migration.syncLegacyPanelName(nameNode, nameRoot), true);
  assert.strictEqual(fs.readFileSync(installedManifest, "utf8"), packagedManifest);
  assert.deepStrictEqual(fs.readdirSync(path.dirname(installedManifest)), ["manifest.xml"], "no temporary file left");
  assert.strictEqual(migration.syncLegacyPanelName(nameNode, path.join(nameSandbox, "missing")), false, "a failure is not an error");
  assert.strictEqual(migration.syncLegacyPanelName(null, nameRoot), false);
  fs.rmSync(nameSandbox, { recursive: true, force: true });

  // Paths
  assert.ok(migration.upiaPath("mac").endsWith("/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent"));
  assert.strictEqual(
    migration.upiaPath("win", { CommonProgramW6432: "C:\\Program Files\\Common Files", CommonProgramFiles: "C:\\Program Files (x86)\\Common Files" }),
    "C:\\Program Files\\Common Files\\Adobe\\Adobe Desktop Common\\RemoteComponents\\UPI\\UnifiedPluginInstallerAgent\\UnifiedPluginInstallerAgent.exe",
    "the 64-bit Common Files, like install.ps1"
  );
  assert.strictEqual(migration.uxpPluginsFolder("mac", "/Users/me"), "/Users/me/Library/Application Support/Adobe/UXP/Plugins/External");
  assert.strictEqual(migration.uxpPluginsFolder("win", "C:\\Users\\me", { APPDATA: "C:\\Users\\me\\AppData\\Roaming" }), "C:\\Users\\me\\AppData\\Roaming\\Adobe\\UXP\\Plugins\\External");
  assert.strictEqual(migration.hasTypeRPlugin(["com.scanr.typer_3.0.0", "other_1.0.0"]), true);
  assert.strictEqual(migration.hasTypeRPlugin(["com.scanr.typer.silicon_1.0.0", "com.other_1"]), false);

  // Packages
  assert.strictEqual(migration.validateUxpPackage(typerPackage).version, "3.0.0");
  assert.throws(() => migration.validateUxpPackage(ccx({ id: "fr.scanr.typer.silicon", version: "1.0.0" })), (error) => error.code === "package");
  assert.throws(() => migration.validateUxpPackage(strToU8("<html>Not Found</html>".repeat(10))), (error) => error.code === "package");
  const releases = [
    { tag_name: "3.1.0", draft: false, prerelease: true, assets: [{ name: "TypeR-UXP.ccx", browser_download_url: "http://127.0.0.1:1/pre.ccx" }] },
    { tag_name: "3.0.1", draft: false, prerelease: false, assets: [{ name: "TypeR.zip", browser_download_url: "http://127.0.0.1:1/TypeR.zip" }, { name: "TypeR-UXP.ccx", browser_download_url: "http://127.0.0.1:1/301.ccx" }] },
    { tag_name: "3.0.0", draft: false, prerelease: false, assets: [{ name: "TypeR-UXP.ccx", browser_download_url: "http://127.0.0.1:1/300.ccx" }] },
    { tag_name: "2.5.0", draft: false, prerelease: false, assets: [{ name: "TypeR.zip", browser_download_url: "http://127.0.0.1:1/250.zip" }] },
  ];
  assert.strictEqual(migration.pickUxpPackageUrl(releases), "http://127.0.0.1:1/301.ccx", "newest stable release with a .ccx");
  assert.strictEqual(migration.pickUxpPackageUrl([releases[3]]), null);

  // Download: production URL, test mode from the local release list only
  const fetches = [];
  const fakeFetch = (routes) => async (url) => {
    fetches.push(url);
    const body = routes[url];
    if (body === undefined) return { ok: false, status: 404 };
    return { ok: true, status: 200, json: async () => body, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
  };
  const bytes = await migration.downloadUxpPackage(null, fakeFetch({ [migration.UXP_PACKAGE_URL]: typerPackage }));
  assert.strictEqual(bytes.length, typerPackage.length);
  const testConfig = parseUpdateTestConfig({ enabled: true, releasesUrl: "http://127.0.0.1:17832/releases", currentVersion: "3.0.0", forceUxpMigration: true });
  assert.strictEqual(testConfig.forceUxpMigration, true);
  assert.strictEqual(parseUpdateTestConfig({ enabled: true, releasesUrl: "http://127.0.0.1:17832/releases", currentVersion: "3.0.0" }).forceUxpMigration, false);
  fetches.length = 0;
  await migration.downloadUxpPackage(testConfig, fakeFetch({ "http://127.0.0.1:17832/releases": releases, "http://127.0.0.1:1/301.ccx": typerPackage }));
  assert.deepStrictEqual(fetches, ["http://127.0.0.1:17832/releases", "http://127.0.0.1:1/301.ccx"]);
  await assert.rejects(
    migration.downloadUxpPackage(testConfig, fakeFetch({ "http://127.0.0.1:17832/releases": [{ tag_name: "3.0.0", assets: [{ name: "TypeR-UXP.ccx", browser_download_url: "https://example.com/x.ccx" }] }] })),
    (error) => error.code === "download",
    "test mode never downloads from a remote address"
  );
  await assert.rejects(migration.downloadUxpPackage(null, fakeFetch({})), (error) => error.code === "download");
  await assert.rejects(
    migration.downloadUxpPackage(null, fakeFetch({ [migration.UXP_PACKAGE_URL]: strToU8("<html>rate limited</html>".repeat(10)) })),
    (error) => error.code === "package"
  );

  // The installer, through a fake Node.js
  const fakeNode = ({ installs, exitError, stdout, platform = "darwin" }) => {
    const files = new Map();
    let plugins = [];
    const calls = [];
    return {
      calls,
      files,
      node: {
        os: { platform: () => platform, homedir: () => "/Users/me", tmpdir: () => "/tmp" },
        path: { join: (...parts) => parts.join("/") },
        env: {},
        Buffer,
        fs: {
          writeFileSync: (file, data) => files.set(file, data),
          readFileSync: (file, encoding) => {
            if (!files.has(file)) throw new Error("Missing " + file);
            return encoding ? String(files.get(file)) : files.get(file);
          },
          unlinkSync: (file) => files.delete(file),
          existsSync: (file) => file === migration.upiaPath(platform === "win32" ? "win" : "mac", {}),
          readdirSync: () => plugins,
        },
        childProcess: {
          execFile: (file, args, options, callback) => {
            calls.push({ file, args, options, packageWritten: files.has(args[1]) });
            if (installs) {
              plugins = ["com.scanr.typer_3.0.0"];
              const hostPlatform = platform === "win32" ? "win" : "mac";
              const payload = manual.readPluginPackage(typerPackage);
              const root = migration.uxpPluginsFolder(hostPlatform, "/Users/me", {}) + "/" + plugins[0];
              payload.files.forEach((entry) => files.set(root + "/" + entry.name, Buffer.from(entry.data)));
              files.set(migration.uxpRegistryPath(hostPlatform, "/Users/me", {}), manual.registerPlugin("", payload.manifest, platform));
            }
            setTimeout(() => callback(exitError || null, stdout || "", ""), 0);
          },
        },
      },
    };
  };
  const good = fakeNode({ installs: true, stdout: "Installation Successful for extension with file path = /tmp/x.ccx" });
  assert.deepStrictEqual(migration.readUxpEnvironment(good.node), { installerAvailable: true, uxpInstalled: false });
  assert.strictEqual(await migration.runUxpInstaller(good.node, typerPackage), "creativeCloud");
  assert.strictEqual(good.calls.length, 1);
  assert.strictEqual(good.calls[0].file, migration.upiaPath("mac"));
  assert.strictEqual(good.calls[0].args[0], "--install");
  assert.ok(good.calls[0].args[1].startsWith("/tmp/TypeR-UXP-") && good.calls[0].packageWritten, "the package goes to the temporary folder");
  assert.ok(!good.files.has(good.calls[0].args[1]), "the temporary package is removed");
  assert.deepStrictEqual(migration.readUxpEnvironment(good.node), { installerAvailable: true, uxpInstalled: true });
  const silentGood = fakeNode({ installs: true });
  assert.strictEqual(await migration.runUxpInstaller(silentGood.node, typerPackage), "creativeCloud", "a quiet installer is accepted only when the actual package is installed");
  const windowsGood = fakeNode({ installs: true, platform: "win32" });
  assert.strictEqual(await migration.runUxpInstaller(windowsGood.node, typerPackage), "creativeCloud");
  const failed = fakeNode({ installs: false, exitError: Object.assign(new Error("Command failed"), { code: 1 }) });
  await assert.rejects(migration.runUxpInstaller(failed.node, typerPackage), (error) => error.code === "installer");
  await assert.rejects(migration.runUxpInstaller(null, typerPackage), (error) => error.code === "node");
  assert.deepStrictEqual(migration.readUxpEnvironment(null), { installerAvailable: false, uxpInstalled: false });

  // Installation by hand, on real files
  const fullPackage = zipSync({
    "manifest.json": strToU8(JSON.stringify({ id: "com.scanr.typer", name: "TypeR", version: "3.1.0", host: { app: "PS", minVersion: "26.0.0" } })),
    "index.html": strToU8("<html></html>"),
    "web/index.js": strToU8("// panel"),
  });
  const otherPlugin = { pluginId: "com.other.plugin", name: "Other", path: "$localPlugins/External/com.other.plugin_1.0.0", status: "enabled", type: "uxp", versionString: "1.0.0" };

  assert.deepStrictEqual(JSON.parse(manual.registerPlugin("", { id: "com.scanr.typer", name: "TypeR", version: "3.1.0", host: { minVersion: "26.0.0" } })), {
    plugins: [{ hostMinVersion: "26.0.0", name: "TypeR", path: "$localPlugins/External/com.scanr.typer_3.1.0", pluginId: "com.scanr.typer", status: "enabled", type: "uxp", versionString: "3.1.0" }],
  }, "the entry Creative Cloud's installer writes");
  const windowsRegistry = JSON.parse(manual.registerPlugin("", { id: "com.scanr.typer", version: "3.1.0" }, "win32"));
  assert.strictEqual(windowsRegistry.plugins[0].path, "$localPlugins\\External\\com.scanr.typer_3.1.0", "Photoshop Windows requires backslashes when resolving $localPlugins");
  assert.strictEqual(manual.registeredPluginFolder(JSON.stringify(windowsRegistry)), "com.scanr.typer_3.1.0");
  const registered = JSON.parse(manual.registerPlugin(JSON.stringify({ extra: 1, plugins: [otherPlugin, { pluginId: "com.scanr.typer", path: "$localPlugins/External/com.scanr.typer_3.0.0" }] }), { id: "com.scanr.typer", name: "TypeR", version: "3.1.0", host: { minVersion: "26.0.0" } }));
  assert.strictEqual(registered.extra, 1);
  assert.deepStrictEqual(registered.plugins.map((plugin) => plugin.pluginId), ["com.other.plugin", "com.scanr.typer"], "other plugins are kept, the old entry replaced");
  assert.strictEqual(registered.plugins[1].versionString, "3.1.0");
  assert.throws(() => manual.registerPlugin("{not json", { id: "com.scanr.typer" }), "an unreadable registry is never replaced");
  assert.throws(() => manual.registerPlugin('{"plugins":{}}', { id: "com.scanr.typer" }));
  assert.throws(() => manual.readPluginPackage(zipSync({ "index.html": strToU8("x") })), /manifest/);
  assert.throws(() => manual.readPluginPackage(ccx({ id: "com.other.plugin", version: "1.0.0" })), /identity/);
  assert.throws(() => manual.readPluginPackage(ccx({ id: "com.scanr.typer", version: "../../evil" })), /version/);
  assert.throws(() => manual.readPluginPackage(zipSync({
    "manifest.json": strToU8(JSON.stringify({ id: "com.scanr.typer", version: "3.1.0" })),
    "../../evil.js": strToU8("x"),
  })), /Unsafe/, "nothing lands outside the plugin's folder");

  const folders = ["com.scanr.typer_3.0.0", "com.scanr.typer_3.1.0", "com.scanr.typer_3.1.0.installing", "com.other.plugin_1.0.0"];
  const registryFor = (version) => manual.registerPlugin("", { id: "com.scanr.typer", name: "TypeR", version, host: { minVersion: "26.0.0" } });
  assert.deepStrictEqual(manual.stalePluginFolders(folders, registryFor("3.1.0"), "com.scanr.typer_3.1.0"), ["com.scanr.typer_3.0.0", "com.scanr.typer_3.1.0.installing"]);
  assert.deepStrictEqual(manual.stalePluginFolders(folders, registryFor("3.1.0"), "com.scanr.typer_3.0.0"), [], "the running version stays until Photoshop restarts");
  assert.strictEqual(migration.hasTypeRPlugin(["com.scanr.typer_3.1.0.installing"]), false, "an interrupted installation is not an installation");

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "typer-manual-install-"));
  const realNode = ({ output, exitError, home, hasInstaller, platform = "darwin" }) => {
    const calls = [];
    const upia = migration.upiaPath(platform === "win32" ? "win" : "mac");
    return {
      calls,
      node: {
        fs: { ...fs, existsSync: (file) => (file === upia ? !!hasInstaller : fs.existsSync(file)) },
        path,
        Buffer,
        os: { platform: () => platform, homedir: () => home, tmpdir: () => os.tmpdir() },
        env: platform === "win32" ? { APPDATA: path.join(home, "roaming") } : {},
        childProcess: {
          execFile: (file, args, options, callback) => {
            calls.push(args);
            setTimeout(() => callback(exitError || null, output || "", ""), 0);
          },
        },
      },
    };
  };
  const installedFolder = (home) => path.join(migration.uxpPluginsFolder("mac", home), "com.scanr.typer_3.1.0");

  // No Creative Cloud: the plugin folder and its registration
  const bare = path.join(sandbox, "bare");
  const bareNode = realNode({ home: bare });
  assert.strictEqual(await migration.runUxpInstaller(bareNode.node, fullPackage), "manual");
  assert.strictEqual(bareNode.calls.length, 0);
  assert.strictEqual(fs.readFileSync(path.join(installedFolder(bare), "web", "index.js"), "utf8"), "// panel");
  assert.strictEqual(JSON.parse(fs.readFileSync(migration.uxpRegistryPath("mac", bare), "utf8")).plugins[0].versionString, "3.1.0");
  assert.deepStrictEqual(fs.readdirSync(migration.uxpPluginsFolder("mac", bare)), ["com.scanr.typer_3.1.0"], "no staging folder left");
  fs.writeFileSync(path.join(installedFolder(bare), "stale.js"), "old");
  assert.strictEqual(await migration.runUxpInstaller(bareNode.node, fullPackage), "manual");
  assert.ok(!fs.existsSync(path.join(installedFolder(bare), "stale.js")), "a reinstallation replaces the folder");

  // An unreadable registry stops the installation and is left as it is
  const broken = path.join(sandbox, "broken");
  fs.mkdirSync(path.dirname(migration.uxpRegistryPath("mac", broken)), { recursive: true });
  fs.writeFileSync(migration.uxpRegistryPath("mac", broken), "{not json");
  await assert.rejects(migration.runUxpInstaller(realNode({ home: broken }).node, fullPackage), (error) => error.code === "installer");
  assert.strictEqual(fs.readFileSync(migration.uxpRegistryPath("mac", broken), "utf8"), "{not json");
  assert.ok(!fs.existsSync(installedFolder(broken)));

  // Creative Cloud's installer reports a failure with exit code 0: installed by hand
  const failing = path.join(sandbox, "failing");
  const failingNode = realNode({ home: failing, hasInstaller: true, output: "Failed to install, status = -410!" });
  assert.strictEqual(await migration.runUxpInstaller(failingNode.node, fullPackage), "manual");
  assert.strictEqual(failingNode.calls.length, 1);
  assert.ok(fs.existsSync(installedFolder(failing)));

  // Reproduced on Windows: exit 0, empty output and no installed files. Also
  // reject a success message with no files: only disk/registration count.
  for (const output of ["", "Installation Successful"]) {
    const silentHome = path.join(sandbox, output ? "lying" : "silent");
    const silentNode = realNode({ home: silentHome, hasInstaller: true, output });
    assert.strictEqual(await migration.runUxpInstaller(silentNode.node, fullPackage), "manual");
    assert.strictEqual(silentNode.calls.length, 1);
    assert.strictEqual(fs.readFileSync(path.join(installedFolder(silentHome), "web", "index.js"), "utf8"), "// panel");
  }
  if (process.platform === "win32") {
    const windowsHome = path.join(sandbox, "windows");
    const windowsNode = realNode({ home: windowsHome, hasInstaller: true, platform: "win32" });
    assert.strictEqual(await migration.runUxpInstaller(windowsNode.node, fullPackage), "manual");
    const registration = JSON.parse(fs.readFileSync(migration.uxpRegistryPath("win", windowsHome, windowsNode.node.env), "utf8"));
    assert.strictEqual(registration.plugins[0].path, "$localPlugins\\External\\com.scanr.typer_3.1.0", "the actual Windows fallback supplies its platform to the shared registry writer");
    const installed = path.join(migration.uxpPluginsFolder("win", windowsHome, windowsNode.node.env), "com.scanr.typer_3.1.0", "web", "index.js");
    assert.strictEqual(fs.readFileSync(installed, "utf8"), "// panel");
  }

  // The test mode skips Creative Cloud's installer
  const forcedHome = path.join(sandbox, "forced");
  const forcedNode = realNode({ home: forcedHome, hasInstaller: true, output: "Installation Successful" });
  assert.strictEqual(await migration.runUxpInstaller(forcedNode.node, fullPackage, { forceManual: true }), "manual");
  assert.strictEqual(forcedNode.calls.length, 0);
  assert.strictEqual(parseUpdateTestConfig({ enabled: true, releasesUrl: "http://127.0.0.1:1/r", currentVersion: "3.0.0", forceManualPluginInstall: true }).forceManualPluginInstall, true);

  // The install script, on its own sandbox: same files and same registration
  if (process.platform === "darwin") {
    const packageFile = path.join(sandbox, "TypeR-UXP.ccx");
    fs.writeFileSync(packageFile, fullPackage);
    const scriptRoot = path.join(sandbox, "script", "UXP");
    const runScript = (args) => childProcess.spawnSync("bash", [path.resolve(__dirname, "../installer/install_mac.sh"), "--uxp", ...args], {
      encoding: "utf8",
      env: { ...process.env, TYPER_UXP_ROOT: scriptRoot, TYPER_INSTALL_NO_UPIA: "1", TYPER_INSTALL_TARGET: path.join(sandbox, "no-cep"), TYPER_INSTALL_SOURCE: path.resolve(__dirname, "..") },
    });
    fs.mkdirSync(path.join(scriptRoot, "PluginsInfo", "v1"), { recursive: true });
    fs.writeFileSync(path.join(scriptRoot, "PluginsInfo", "v1", "PS.json"), JSON.stringify({ plugins: [otherPlugin] }));
    const installedByScript = runScript([packageFile]);
    assert.strictEqual(installedByScript.status, 0, installedByScript.stderr + installedByScript.stdout);
    assert.strictEqual(fs.readFileSync(path.join(scriptRoot, "Plugins", "External", "com.scanr.typer_3.1.0", "web", "index.js"), "utf8"), "// panel");
    const scriptRegistry = JSON.parse(fs.readFileSync(path.join(scriptRoot, "PluginsInfo", "v1", "PS.json"), "utf8"));
    assert.deepStrictEqual(scriptRegistry.plugins[0], otherPlugin, "other plugins are kept");
    assert.deepStrictEqual(scriptRegistry, JSON.parse(manual.registerPlugin(JSON.stringify({ plugins: [otherPlugin] }), { id: "com.scanr.typer", name: "TypeR", version: "3.1.0", host: { minVersion: "26.0.0" } })), "same registration as the panels");
    // A Legacy panel still installed gets its new name; none is created
    assert.strictEqual(fs.existsSync(path.join(sandbox, "no-cep", "CSXS")), false);
    const scriptManifest = path.join(sandbox, "no-cep", "CSXS", "manifest.xml");
    fs.mkdirSync(path.dirname(scriptManifest), { recursive: true });
    fs.writeFileSync(scriptManifest, packagedManifest);
    const renamedByScript = runScript([packageFile]);
    assert.strictEqual(renamedByScript.status, 0, renamedByScript.stderr + renamedByScript.stdout);
    assert.strictEqual(fs.readFileSync(scriptManifest, "utf8"), oldManifest, "same renaming as the panels");
    assert.deepStrictEqual(fs.readdirSync(path.dirname(scriptManifest)), ["manifest.xml"]);
    fs.writeFileSync(packageFile, ccx({ id: "com.other.plugin", version: "1.0.0" }));
    fs.writeFileSync(scriptManifest, packagedManifest);
    assert.notStrictEqual(runScript([packageFile]).status, 0, "only a TypeR package");
    assert.strictEqual(fs.readFileSync(scriptManifest, "utf8"), packagedManifest, "a failed installation renames nothing");
  }
  fs.rmSync(sandbox, { recursive: true, force: true });

  // Outside a CEP panel there is nothing to switch
  assert.strictEqual(migration.readUxpMigrationState(null).forced, false);

  console.log("TypeR UXP switch tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
