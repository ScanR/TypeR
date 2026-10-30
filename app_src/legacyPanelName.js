// The name of the Legacy (CEP) panel in Photoshop: the <Menu> of its installed
// manifest, read when Photoshop starts. While TypeR UXP is installed the Legacy
// panel is called "TypeR (old)", so that the two can be told apart.
//
// Applied by the UXP plugin at its start (uxp-src/host/main.js), and by the
// Legacy panel at its start and after installing the plugin (uxpMigration.js).
// A panel update restores the packaged name, and a removed plugin gives the
// name back. install_mac.sh and install.ps1 apply the same replacement.

export const LEGACY_PANEL_NAME = "TypeR";
export const LEGACY_PANEL_OLD_NAME = "TypeR (old)";

const MENU = /<Menu>\s*TypeR(?:\s*\(old\))?\s*<\/Menu>/;

export const legacyManifestWithName = (manifestText, uxpInstalled) => (
  String(manifestText).replace(MENU, "<Menu>" + (uxpInstalled ? LEGACY_PANEL_OLD_NAME : LEGACY_PANEL_NAME) + "</Menu>")
);
