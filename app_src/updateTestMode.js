// Local-only update test configuration. Production builds keep using GitHub
// unless a developer explicitly places this file in the installed extension
// root. Only loopback HTTP endpoints are accepted so this cannot redirect a
// production installation to an arbitrary remote update server.
const UPDATE_TEST_CONFIG_FILE = ".typer-update-test.json";

const isLoopbackHttpUrl = (value) => {
  const match = String(value || "").match(
    /^http:\/\/(127\.0\.0\.1|localhost)(?::(\d{1,5}))?(?:\/|$)/i
  );
  if (!match) return false;
  const port = match[2] ? Number(match[2]) : 80;
  return port > 0 && port <= 65535;
};

const parseUpdateTestConfig = (raw) => {
  let data;
  try {
    data = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (error) {
    return null;
  }
  if (!data || data.enabled !== true) return null;
  if (!isLoopbackHttpUrl(data.releasesUrl)) return null;

  const currentVersion = String(data.currentVersion || "");
  if (!/^\d+(?:\.\d+){1,3}$/.test(currentVersion)) return null;

  return {
    releasesUrl: data.releasesUrl,
    currentVersion,
    autoInstall: data.autoInstall === true,
    // Opens the switch to TypeR UXP whatever the Photoshop version or the
    // installed plugins; the package comes from the local release list
    forceUxpMigration: data.forceUxpMigration === true,
  };
};

export { UPDATE_TEST_CONFIG_FILE, isLoopbackHttpUrl, parseUpdateTestConfig };
