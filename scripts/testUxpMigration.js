// Switch from the Legacy (CEP) panel to TypeR UXP (app_src/uxpMigration.js):
// who is offered the switch, the package checks, the installer call and the
// local test mode.
const assert = require("assert");
const { strToU8, zipSync } = require("fflate");
const load = require("./helpers/loadAppModule")();
const migration = load("app_src/uxpMigration.js");
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
  const ok = { isUxpPanel: false, appVersion: "26.0.0", uxpInstalled: false, installerAvailable: true };
  assert.strictEqual(migration.uxpMigrationEligibility(ok), "ok");
  assert.strictEqual(migration.uxpMigrationEligibility({ ...ok, isUxpPanel: true }), "uxp");
  assert.strictEqual(migration.uxpMigrationEligibility({ ...ok, appVersion: "25.12.0" }), "photoshop", "Photoshop 2024 stays on Legacy");
  assert.strictEqual(migration.uxpMigrationEligibility({ ...ok, uxpInstalled: true }), "installed");
  assert.strictEqual(migration.uxpMigrationEligibility({ ...ok, installerAvailable: false }), "installer", "no Creative Cloud, no offer");

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
          unlinkSync: (file) => files.delete(file),
          existsSync: (file) => file === migration.upiaPath(platform === "win32" ? "win" : "mac", {}),
          readdirSync: () => plugins,
        },
        childProcess: {
          execFile: (file, args, options, callback) => {
            calls.push({ file, args, options, packageWritten: files.has(args[1]) });
            if (installs) plugins = ["com.scanr.typer_3.0.0"];
            setTimeout(() => callback(exitError || null, stdout || "", ""), 0);
          },
        },
      },
    };
  };
  const good = fakeNode({ installs: true, stdout: "Installation Successful for extension with file path = /tmp/x.ccx" });
  assert.deepStrictEqual(migration.readUxpEnvironment(good.node), { installerAvailable: true, uxpInstalled: false });
  assert.strictEqual(await migration.runUxpInstaller(good.node, typerPackage), true);
  assert.strictEqual(good.calls.length, 1);
  assert.strictEqual(good.calls[0].file, migration.upiaPath("mac"));
  assert.strictEqual(good.calls[0].args[0], "--install");
  assert.ok(good.calls[0].args[1].startsWith("/tmp/TypeR-UXP-") && good.calls[0].packageWritten, "the package goes to the temporary folder");
  assert.strictEqual(good.files.size, 0, "the temporary package is removed");
  assert.deepStrictEqual(migration.readUxpEnvironment(good.node), { installerAvailable: true, uxpInstalled: true });
  const failed = fakeNode({ installs: false, exitError: Object.assign(new Error("Command failed"), { code: 1 }) });
  await assert.rejects(migration.runUxpInstaller(failed.node, typerPackage), (error) => error.code === "installer");
  await assert.rejects(migration.runUxpInstaller(null, typerPackage), (error) => error.code === "node");
  assert.deepStrictEqual(migration.readUxpEnvironment(null), { installerAvailable: false, uxpInstalled: false });

  // Outside a CEP panel there is nothing to switch
  assert.strictEqual(migration.readUxpMigrationState(null).forced, false);

  console.log("TypeR UXP switch tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
