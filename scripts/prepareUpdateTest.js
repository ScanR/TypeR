const fs = require("fs");
const path = require("path");
const { strToU8, zipSync } = require("fflate");

const rootDir = path.resolve(__dirname, "..");
const testDir = path.join(rootDir, ".update-test");
const installedDir = path.join(
  process.env.APPDATA || "",
  "Adobe",
  "CEP",
  "extensions",
  "typertools"
);
const port = Number(process.argv[2] || 17831);
const folders = ["app", "CSXS", "icons", "locale"];

if (!process.env.APPDATA || !fs.existsSync(installedDir)) {
  throw new Error(`Installed TypeR extension not found: ${installedDir}`);
}
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid update test port: ${port}`);
}

const entries = {};
const addDirectory = (absoluteDir, relativeDir) => {
  for (const item of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const absolutePath = path.join(absoluteDir, item.name);
    const relativePath = path.posix.join(relativeDir, item.name);
    if (item.isDirectory()) {
      addDirectory(absolutePath, relativePath);
    } else if (item.isFile()) {
      entries[relativePath] = new Uint8Array(fs.readFileSync(absolutePath));
    }
  }
};

for (const folder of folders) {
  const source = path.join(rootDir, folder);
  if (!fs.existsSync(source)) throw new Error(`Missing update payload folder: ${source}`);
  addDirectory(source, folder);
}

const marker = {
  version: "3.0.0",
  testId: `local-${Date.now()}`,
  builtAt: new Date().toISOString(),
};
entries["app/update-test-marker.json"] = strToU8(JSON.stringify(marker, null, 2));

entries["app/package.sha256"] = strToU8(Object.keys(entries).filter(name => name !== "app/package.sha256").sort().map(name => require('crypto').createHash('sha256').update(entries[name]).digest('hex') + '  ' + name).join('\n') + '\n');
fs.mkdirSync(testDir, { recursive: true });
const zipPath = path.join(testDir, "TypeR-3.0.0.zip");
fs.writeFileSync(zipPath, Buffer.from(zipSync(entries, { level: 6 })));

const testConfigPath = path.join(installedDir, ".typer-update-test.json");
fs.writeFileSync(testConfigPath, JSON.stringify({
  enabled: true,
  releasesUrl: `http://127.0.0.1:${port}/releases`,
  currentVersion: "2.9.9",
  autoInstall: true,
}, null, 2));

const state = {
  version: "3.0.0",
  port,
  zipPath,
  installedDir,
  testConfigPath,
  marker,
  preparedAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(testDir, "state.json"), JSON.stringify(state, null, 2));
fs.writeFileSync(path.join(testDir, "events.jsonl"), "");
fs.writeFileSync(path.join(testDir, "stdin.txt"), "");

console.log(`Update test prepared: ${zipPath}`);
console.log(`Installed trigger: ${testConfigPath}`);
console.log(`Test marker: ${marker.testId}`);
