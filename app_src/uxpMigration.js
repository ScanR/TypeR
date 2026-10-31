// Moving Legacy (CEP) users to the UXP plugin. Versions up to 2.5.0 update
// themselves to the Legacy 3.x package only, so the Legacy panel offers the
// switch once it is updated: when Photoshop can run the UXP plugin (2025,
// 26.0 or later) and TypeR UXP is not installed yet. The UXP plugin imports
// the Legacy styles, profiles and settings on its first start
// (uxp-src/host/files.js).
//
// The pure helpers are tested in node; the installer runs through the CEP
// panel's Node.js (--enable-nodejs), never in the UXP panel.

import { strFromU8, unzipSync } from "fflate";
import { findNewerReleases, pickUpdateDownloadUrl } from "./updateLogic";
import { makeBuffer } from "./nodeCompat";
import { fetchBody } from "./network";
import { isLoopbackHttpUrl } from "./updateTestMode";
import { UXP_PLUGIN_ID, installPluginFiles, isPluginFolder, pluginFolderName, readPluginPackage } from "./uxpManualInstall";
import { legacyManifestWithName } from "./legacyPanelName";

export { UXP_PLUGIN_ID };
export const UXP_MIN_PHOTOSHOP_MAJOR = 26;
export const UXP_PACKAGE_URL = "https://github.com/ScanR/TypeR/releases/latest/download/TypeR-UXP.ccx";
export const UXP_RELEASE_PAGE = "https://github.com/ScanR/TypeR/releases/latest";
// "Later" asks again a week later
export const UXP_MIGRATION_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
const INSTALLER_TIMEOUT_MS = 3 * 60 * 1000;

export const photoshopMajor = (appVersion) => {
  const match = /^\s*(\d+)/.exec(String(appVersion || ""));
  return match ? Number(match[1]) : 0;
};

// Creative Cloud's plugin installer (the same one the install scripts use)
export const upiaPath = (platform, env = {}) => {
  if (platform === "win") {
    const common = env.CommonProgramW6432 || env.CommonProgramFiles || "C:\\Program Files\\Common Files";
    return common + "\\Adobe\\Adobe Desktop Common\\RemoteComponents\\UPI\\UnifiedPluginInstallerAgent\\UnifiedPluginInstallerAgent.exe";
  }
  return "/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent";
};

// Where Creative Cloud installs third-party UXP plugins
export const uxpPluginsFolder = (platform, home, env = {}) => (
  platform === "win"
    ? (env.APPDATA || home + "\\AppData\\Roaming") + "\\Adobe\\UXP\\Plugins\\External"
    : home + "/Library/Application Support/Adobe/UXP/Plugins/External"
);

// The file Photoshop reads its third-party UXP plugins from
export const uxpRegistryPath = (platform, home, env = {}) => (
  platform === "win"
    ? (env.APPDATA || home + "\\AppData\\Roaming") + "\\Adobe\\UXP\\PluginsInfo\\v1\\PS.json"
    : home + "/Library/Application Support/Adobe/UXP/PluginsInfo/v1/PS.json"
);

export const hasTypeRPlugin = (folderNames) => (folderNames || []).some(isPluginFolder);

// "ok", or why the switch is not offered: "uxp" (already the UXP panel),
// "photoshop" (too old), "installed" (TypeR UXP is there)
export const uxpMigrationEligibility = ({ isUxpPanel, appVersion, uxpInstalled }) => {
  if (isUxpPanel) return "uxp";
  if (photoshopMajor(appVersion) < UXP_MIN_PHOTOSHOP_MAJOR) return "photoshop";
  if (uxpInstalled) return "installed";
  return "ok";
};

// The offer opens by itself only for existing users (a new user just picked
// an edition in the installer), with update checks on, until they decline;
// "Later" snoozes it. The test mode forces it.
export const shouldOfferUxpMigration = ({ eligibility, record, now, notFirstTime, checkUpdates, force }) => {
  if (force) return true;
  if (eligibility !== "ok" || !notFirstTime || checkUpdates === false) return false;
  if (record && record.declined) return false;
  return !(record && Number(record.snoozedUntil) > now);
};

// Each start of the Legacy panel says where the new TypeR is, until declined.
// A Photoshop too old for the plugin has only this panel: nothing to say.
export const shouldShowUxpInstalledNotice = ({ eligibility, hidden, force }) => (
  eligibility === "installed" && !hidden && !force
);

// What the Legacy panel opens first at its start, before the walkthrough and
// What's new, since the goal is to move people to the new TypeR: the notice
// when it is installed, otherwise the offer. Null when there is nothing to say.
export const startupUxpGuide = ({ eligibility, forced, noticeHidden, record, now, notFirstTime, checkUpdates }) => {
  if (shouldShowUxpInstalledNotice({ eligibility, hidden: noticeHidden, force: forced })) return { forced, notice: true };
  if (shouldOfferUxpMigration({ eligibility, record, now, notFirstTime, checkUpdates, force: forced })) return { forced, notice: false };
  return null;
};

export const snoozedUxpMigration = (now) => ({ snoozedUntil: now + UXP_MIGRATION_SNOOZE_MS });
export const declinedUxpMigration = () => ({ declined: true });

// The newest stable release with a TypeR .ccx (test mode reads a local
// release list; production downloads the latest release's asset directly)
export const pickUxpPackageUrl = (releases) => {
  const newest = findNewerReleases(releases, "0.0.0", ".ccx")[0];
  return newest ? pickUpdateDownloadUrl(newest, ".ccx") : null;
};

// Only a TypeR plugin package gets installed (a failed download can be an HTML
// error page)
export const validateUxpPackage = (bytes) => {
  if (!bytes || bytes.length < 100 || bytes.length > 80 * 1024 * 1024) throw codedError("package", "Invalid package size");
  let manifest;
  try {
    const entries = unzipSync(bytes, { filter: (entry) => entry.name === "manifest.json" });
    manifest = JSON.parse(strFromU8(entries["manifest.json"]));
  } catch (error) {
    throw codedError("package", "Not a plugin package");
  }
  if (!manifest || manifest.id !== UXP_PLUGIN_ID) throw codedError("package", "Not a TypeR package");
  return manifest;
};

const codedError = (code, message) => Object.assign(new Error(message), { code });

// The package of the latest release, checked. In test mode it comes from the
// local release list, and only from a loopback address.
export const downloadUxpPackage = async (testConfig, fetchImpl) => {
  let url = UXP_PACKAGE_URL;
  try {
    if (testConfig) {
      const releases = await fetchBody(testConfig.releasesUrl, { headers: { Accept: "application/vnd.github.v3+json" } }, "json", 20000, fetchImpl);
      url = pickUxpPackageUrl(releases);
      if (!url || !isLoopbackHttpUrl(url)) throw new Error("No local TypeR UXP package");
    }
    const buffer = await fetchBody(url, { headers: { Accept: "application/octet-stream" } }, "arrayBuffer", 120000, fetchImpl);
    const bytes = new Uint8Array(buffer);
    validateUxpPackage(bytes);
    return bytes;
  } catch (error) {
    throw error && error.code ? error : codedError("download", String((error && error.message) || error));
  }
};

/* ===================== CEP panel (Node.js) ===================== */

export const getNode = () => {
  const nodeRequire = (typeof window !== "undefined" && window.cep_node && window.cep_node.require) ||
    (typeof window !== "undefined" && typeof window.require === "function" ? window.require : null);
  if (!nodeRequire) return null;
  let env = {};
  try {
    env = nodeRequire("process").env || {};
  } catch (error) {
    // CEP 6.1 may not expose process: the default paths apply
  }
  try {
    return {
      fs: nodeRequire("fs"),
      os: nodeRequire("os"),
      path: nodeRequire("path"),
      childProcess: nodeRequire("child_process"),
      Buffer: nodeRequire("buffer").Buffer,
      env,
    };
  } catch (error) {
    return null;
  }
};

export const nodePlatform = (node) => (node && node.os.platform() === "win32" ? "win" : "mac");

export const readUxpEnvironment = (node) => {
  if (!node) return { installerAvailable: false, uxpInstalled: false };
  const platform = nodePlatform(node);
  let names = [];
  try {
    names = node.fs.readdirSync(uxpPluginsFolder(platform, node.os.homedir(), node.env));
  } catch (error) {
    names = [];
  }
  let installerAvailable = false;
  try {
    installerAvailable = node.fs.existsSync(upiaPath(platform, node.env));
  } catch (error) {
    installerAvailable = false;
  }
  return { installerAvailable, uxpInstalled: hasTypeRPlugin(names) };
};

// The Legacy panel's name in Photoshop follows the plugin's presence
// (legacyPanelName.js); Photoshop reads it at its next start. Returns whether
// the manifest changed. A failure only leaves the name as it is.
export const syncLegacyPanelName = (node, extensionRoot) => {
  if (!node || !extensionRoot) return false;
  const file = node.path.join(extensionRoot, "CSXS", "manifest.xml");
  const temporary = file + ".tmp-" + Date.now();
  try {
    const text = node.fs.readFileSync(file, "utf8");
    const next = legacyManifestWithName(text, readUxpEnvironment(node).uxpInstalled);
    if (next === text) return false;
    node.fs.writeFileSync(temporary, next, "utf8");
    node.fs.renameSync(temporary, file);
    return true;
  } catch (error) {
    console.warn("TypeR: could not rename the Legacy panel", error);
    try {
      node.fs.unlinkSync(temporary);
    } catch (cleanup) {}
    return false;
  }
};

// UPI can return 0 and no output without doing anything. Verify the registered
// version and every package file, rather than accepting its exit code alone.
const hasInstalledPackage = (node, bytes) => {
  try {
    const { manifest, files } = readPluginPackage(bytes);
    const platform = nodePlatform(node);
    const home = node.os.homedir();
    const registry = JSON.parse(node.fs.readFileSync(uxpRegistryPath(platform, home, node.env), "utf8").replace(/^\uFEFF/, ""));
    const folder = pluginFolderName(manifest);
    const registeredPath = "$localPlugins/External/" + folder;
    const entry = (registry.plugins || []).find((plugin) => plugin && plugin.pluginId === manifest.id &&
      plugin.versionString === manifest.version && plugin.status === "enabled" && plugin.type === "uxp" &&
      String(plugin.path || "").replace(/\\/g, "/") === registeredPath);
    if (!entry || (platform === "win" && entry.path !== registeredPath.replace(/\//g, "\\"))) return false;
    const root = node.path.join(uxpPluginsFolder(platform, home, node.env), folder);
    for (const file of files) {
      const actual = node.fs.readFileSync(node.path.join(root, ...file.name.split("/")));
      if (actual.length !== file.data.length) return false;
      for (let index = 0; index < actual.length; index += 1) {
        if (actual[index] !== file.data[index]) return false;
      }
    }
    return true;
  } catch (error) {
    return false;
  }
};

// Hands the package to Creative Cloud's plugin installer, which adds the
// plugin to the running Photoshop. The package goes to the temporary folder:
// macOS asks Creative Cloud for access to Desktop or Downloads otherwise.
// Its exit code does not tell: a failure can still exit with 0.
const runCreativeCloudInstaller = (node, bytes) => new Promise((resolve) => {
  const file = node.path.join(node.os.tmpdir(), "TypeR-UXP-" + Date.now() + ".ccx");
  try {
    node.fs.writeFileSync(file, makeBuffer(node.Buffer, bytes));
  } catch (error) {
    resolve(false);
    return;
  }
  node.childProcess.execFile(upiaPath(nodePlatform(node), node.env), ["--install", file], { timeout: INSTALLER_TIMEOUT_MS, windowsHide: true }, (error, stdout, stderr) => {
    try {
      node.fs.unlinkSync(file);
    } catch (cleanup) {}
    const output = String(stdout || "") + String(stderr || "");
    resolve(!/fail/i.test(output) && (!error || /success/i.test(output)) && hasInstalledPackage(node, bytes));
  });
});

// File access for installPluginFiles(), through the panel's Node.js
const nodeInstallIo = (node) => {
  const { fs, path } = node;
  const platform = nodePlatform(node);
  const home = node.os.homedir();
  const registry = uxpRegistryPath(platform, home, node.env);
  const ensureFolder = (folder) => {
    if (fs.existsSync(folder)) return;
    ensureFolder(path.dirname(folder));
    fs.mkdirSync(folder);
  };
  const removeTree = (target) => {
    let stat;
    try {
      stat = fs.lstatSync(target);
    } catch (error) {
      return;
    }
    if (stat.isDirectory()) {
      fs.readdirSync(target).forEach((name) => removeTree(path.join(target, name)));
      fs.rmdirSync(target);
    } else {
      fs.unlinkSync(target);
    }
  };
  return {
    platform: node.os.platform(),
    pluginsFolder: uxpPluginsFolder(platform, home, node.env),
    join: path.join,
    removeTree,
    rename: (from, to) => fs.renameSync(from, to),
    writeFile: (file, data) => {
      ensureFolder(path.dirname(file));
      fs.writeFileSync(file, makeBuffer(node.Buffer, data));
    },
    readRegistry: () => (fs.existsSync(registry) ? fs.readFileSync(registry, "utf8") : ""),
    writeRegistry: (text) => {
      ensureFolder(path.dirname(registry));
      const temporary = registry + ".tmp-" + Date.now();
      fs.writeFileSync(temporary, text, "utf8");
      fs.renameSync(temporary, registry);
    },
  };
};

// Creative Cloud's plugin installer when it is there and works, otherwise the
// package is installed by hand. Resolves with how: "creativeCloud" (Photoshop
// loads the plugin at once) or "manual" (at its next start).
export const runUxpInstaller = async (node, bytes, options = {}) => {
  if (!node || !node.childProcess) throw codedError("node", "Node.js is unavailable");
  if (!options.forceManual && readUxpEnvironment(node).installerAvailable && await runCreativeCloudInstaller(node, bytes)) {
    return "creativeCloud";
  }
  try {
    await installPluginFiles(bytes, nodeInstallIo(node));
    return "manual";
  } catch (error) {
    throw codedError("installer", String((error && error.message) || error));
  }
};

// The state of this panel and computer, read once (the UXP panel stops at
// "uxp"). The test mode forces the offer.
export const readUxpMigrationState = (testConfig) => {
  const isUxpPanel = typeof window !== "undefined" && !!window.typerUXP;
  const forced = !isUxpPanel && !!(testConfig && testConfig.forceUxpMigration);
  if (isUxpPanel) return { eligibility: "uxp", forced: false };
  let appVersion = "";
  try {
    appVersion = JSON.parse(window.__adobe_cep__.getHostEnvironment()).appVersion;
  } catch (error) {
    appVersion = "";
  }
  const environment = readUxpEnvironment(getNode());
  return { eligibility: uxpMigrationEligibility({ isUxpPanel, appVersion, ...environment }), forced };
};

