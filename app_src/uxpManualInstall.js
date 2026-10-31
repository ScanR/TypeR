// Installing the UXP plugin without Creative Cloud's plugin installer: the
// package is extracted where Creative Cloud would put it, and registered in
// the file Photoshop reads at its start (PluginsInfo/v1/PS.json). Photoshop
// ignores a plugin folder that is not registered there, and loads a new
// registration only at its next start.
//
// Used by the UXP panel's updates (uxp-src/host/services.js) and the Legacy
// panel's switch to UXP (uxpMigration.js), each with its own file access.
// install_mac.sh and install.ps1 do the same steps.

import { strFromU8, unzipSync } from "fflate";

export const UXP_PLUGIN_ID = "com.scanr.typer";
const STAGING_SUFFIX = ".installing";

export const isPluginFolder = (name) => (
  typeof name === "string" && name.indexOf(UXP_PLUGIN_ID + "_") === 0 && !name.endsWith(STAGING_SUFFIX)
);

export const pluginFolderName = (manifest) => manifest.id + "_" + manifest.version;

// The manifest and files of a TypeR plugin package. Nothing in it may land
// outside the plugin's folder.
export const readPluginPackage = (bytes) => {
  const entries = unzipSync(bytes);
  if (!entries["manifest.json"]) throw new Error("Missing TypeR manifest");
  const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
  if (manifest.id !== UXP_PLUGIN_ID) throw new Error("Invalid TypeR identity");
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(String(manifest.version || ""))) throw new Error("Invalid TypeR version");
  const files = Object.keys(entries).filter((name) => !name.endsWith("/")).map((name) => {
    if (name.indexOf("\\") !== -1 || name.charAt(0) === "/" || /^[A-Za-z]:/.test(name) || name.split("/").indexOf("..") !== -1) {
      throw new Error("Unsafe path in the package: " + name);
    }
    return { name, data: entries[name] };
  });
  return { manifest, files };
};

const parseRegistry = (registryText) => {
  const text = String(registryText || "").replace(/^﻿/, "").trim();
  const registry = text ? JSON.parse(text) : {};
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) throw new Error("Invalid plugin registry");
  if (registry.plugins !== undefined && !Array.isArray(registry.plugins)) throw new Error("Invalid plugin registry");
  return registry;
};

// PS.json with this plugin registered. Other plugins are kept, and an
// unreadable file is an error: replacing it would unregister them.
export const registerPlugin = (registryText, manifest, platform = "darwin") => {
  const registry = parseRegistry(registryText);
  const others = (registry.plugins || []).filter((plugin) => !plugin || plugin.pluginId !== manifest.id);
  const host = [].concat(manifest.host || [])[0] || {};
  const entry = {
    hostMinVersion: host.minVersion,
    name: manifest.name,
    // Photoshop's Windows registry reader does not resolve $localPlugins/.
    path: (platform === "win32" ? "$localPlugins\\External\\" : "$localPlugins/External/") + pluginFolderName(manifest),
    pluginId: manifest.id,
    status: "enabled",
    type: "uxp",
    versionString: manifest.version,
  };
  return JSON.stringify({ ...registry, plugins: others.concat(entry) });
};

// The version folder Photoshop loads at its next start
export const registeredPluginFolder = (registryText) => {
  const entry = (parseRegistry(registryText).plugins || []).find((plugin) => plugin && plugin.pluginId === UXP_PLUGIN_ID);
  const match = entry && /[\\/]([^\\/]+)$/.exec(String(entry.path || ""));
  return match ? match[1] : null;
};

// A new version goes next to the running one, whose files cannot be removed
// yet: the folders left over are removed once Photoshop runs the registered
// version.
export const stalePluginFolders = (folderNames, registryText, ownFolder) => {
  if (registeredPluginFolder(registryText) !== ownFolder) return [];
  return (folderNames || []).filter((name) => (
    typeof name === "string" && name !== ownFolder && name.indexOf(UXP_PLUGIN_ID + "_") === 0
  ));
};

// io: { pluginsFolder, join, removeTree, rename, writeFile, readRegistry,
// writeRegistry }. The files go to a staging folder first: an installation cut
// short leaves nothing Photoshop or the next installation could take for a
// plugin, and the registry is written last.
export const installPluginFiles = async (bytes, io) => {
  const { manifest, files } = readPluginPackage(bytes);
  const registry = registerPlugin(await io.readRegistry(), manifest, io.platform);
  const target = io.join(io.pluginsFolder, pluginFolderName(manifest));
  const staging = target + STAGING_SUFFIX;
  await io.removeTree(staging);
  try {
    for (const file of files) await io.writeFile(io.join(staging, ...file.name.split("/")), file.data);
    await io.removeTree(target);
    await io.rename(staging, target);
  } catch (error) {
    try {
      await io.removeTree(staging);
    } catch (cleanupError) {}
    throw error;
  }
  await io.writeRegistry(registry);
  return manifest;
};
