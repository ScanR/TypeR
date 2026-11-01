// The name of the Legacy (CEP) panel in Photoshop: the <Menu> of its installed
// manifest, read when Photoshop starts. It is called "TypeR (CEP)", and "TypeR (old)"
// while TypeR UXP is installed, so that the version in use is always known.
//
// Applied by the UXP plugin at its start (uxp-src/host/main.js), and by the
// Legacy panel at its start and after installing the plugin (uxpMigration.js).
// A panel update restores the packaged name, a removed plugin gives the name
// back, and a panel still called "TypeR" (before 3.0.1) takes the new one.
// install_mac.sh and install.ps1 apply the same replacement.

export const LEGACY_PANEL_NAME = "TypeR (CEP)";
export const LEGACY_PANEL_OLD_NAME = "TypeR (old)";

const MENU = /<Menu>\s*TypeR(?:\s*\((?:old|CEP)\))?\s*<\/Menu>/;

export const legacyManifestWithName = (manifestText, uxpInstalled) => (
  String(manifestText).replace(MENU, "<Menu>" + (uxpInstalled ? LEGACY_PANEL_OLD_NAME : LEGACY_PANEL_NAME) + "</Menu>")
);
