// Local test of the switch from the Legacy panel to TypeR UXP
// (app_src/uxpMigration.js), without publishing a release:
//   npm run test:uxp-migration [-- [--manual] path/to/TypeR-UXP.ccx [port]]
// --manual installs as if Creative Cloud's plugin installer were absent.
// It serves a release list holding only the .ccx (so no Legacy update is
// offered) and writes the update test file into the installed Legacy
// extension with forceUxpMigration: the next time the Legacy panel opens, it
// offers the switch whatever the Photoshop version or the installed plugins.
// Ctrl+C stops the server and removes the test file.
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const version = require("../package.json").version;
const manual = process.argv.includes("--manual");
const args = process.argv.slice(2).filter((arg) => arg !== "--manual");
const packagePath = path.resolve(args[0] || path.join(root, "Releases", "TypeR-UXP.ccx"));
const port = Number(args[1] || 17832);
const baseUrl = "http://127.0.0.1:" + port;
const extensionRoot = process.platform === "win32"
  ? path.join(process.env.APPDATA || "", "Adobe", "CEP", "extensions", "typertools")
  : path.join(os.homedir(), "Library", "Application Support", "Adobe", "CEP", "extensions", "typertools");
const testFile = path.join(extensionRoot, ".typer-update-test.json");

if (!fs.existsSync(packagePath)) throw new Error("Missing TypeR UXP package: " + packagePath + " (npm run package:uxp)");
if (!fs.existsSync(path.join(extensionRoot, "CSXS"))) throw new Error("The Legacy extension is not installed: " + extensionRoot);
if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("Invalid port: " + port);

const server = http.createServer((request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Cache-Control", "no-store");
  console.log("[uxp-migration-test] " + request.method + " " + request.url);
  if (request.url === "/releases") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify([{
      tag_name: version,
      name: "TypeR " + version + " (local TypeR UXP switch test)",
      draft: false,
      prerelease: false,
      published_at: new Date().toISOString(),
      body_html: "<p>Local test, no release was published.</p>",
      assets: [{ name: "TypeR-UXP.ccx", browser_download_url: baseUrl + "/TypeR-UXP.ccx" }],
    }]));
    return;
  }
  if (request.url === "/TypeR-UXP.ccx") {
    response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": fs.statSync(packagePath).size });
    fs.createReadStream(packagePath).pipe(response);
    return;
  }
  response.writeHead(404);
  response.end();
});

server.listen(port, "127.0.0.1", () => {
  fs.writeFileSync(testFile, JSON.stringify({
    enabled: true,
    releasesUrl: baseUrl + "/releases",
    currentVersion: version,
    forceUxpMigration: true,
    forceManualPluginInstall: manual,
  }, null, 2));
  console.log("Serving " + packagePath + " at " + baseUrl);
  console.log("Test file: " + testFile);
  console.log("Open (or reopen) the Legacy panel in Photoshop: it offers TypeR UXP after a few seconds. Ctrl+C to stop.");
});

const stop = () => {
  try {
    fs.unlinkSync(testFile);
  } catch (error) {
    // The panel removes it after a successful switch
  }
  server.close(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
