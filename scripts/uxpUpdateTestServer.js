// Local test of the UXP panel's update without a Photoshop restart
// (app_src/uxpUpdateScript.js), without publishing a release:
//   npm run build:uxp && npm run test:uxp-update [-- [--manual] [port]]
// --manual installs as if Creative Cloud's plugin installer were absent.
// It serves the built plugin as the next version and writes the update test
// file (autoInstall) into TypeR's storage. The next time the panel loads, it
// updates itself, and the new version's panel reports here once it runs.
// Ctrl+C stops the server and removes the test file.
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { strToU8, zipSync } = require("fflate");

const root = path.resolve(__dirname, "..");
const plugin = path.join(root, "uxp");
const manual = process.argv.includes("--manual");
const port = Number(process.argv.slice(2).find((arg) => arg !== "--manual") || 17843);
const baseUrl = "http://127.0.0.1:" + port;
const storageRoot = process.platform === "win32"
  ? path.join(process.env.APPDATA || "", "TypeR", "UXP")
  : path.join(os.homedir(), "Library", "Application Support", "TypeR", "UXP");
const testFile = path.join(storageRoot, ".typer-update-test.json");

if (!fs.existsSync(path.join(plugin, "manifest.json"))) throw new Error("Missing " + plugin + " (npm run build:uxp)");
if (!fs.existsSync(storageRoot)) throw new Error("TypeR UXP has never started here: " + storageRoot);
if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("Invalid port: " + port);

const manifest = JSON.parse(fs.readFileSync(path.join(plugin, "manifest.json"), "utf8"));
const parts = manifest.version.split(".").map(Number);
const nextVersion = [parts[0], parts[1], parts[2] + 1].join(".");

const entries = {};
const add = (folder, relative) => {
  for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
    if (item.name === ".DS_Store") continue;
    const full = path.join(folder, item.name);
    const name = relative ? relative + "/" + item.name : item.name;
    if (item.isDirectory()) add(full, name);
    else entries[name] = new Uint8Array(fs.readFileSync(full));
  }
};
add(plugin, "");
entries["manifest.json"] = strToU8(JSON.stringify({ ...manifest, version: nextVersion }));
// Reports that the new version's panel runs and can call Photoshop
const report = "<script>setTimeout(function(){var send=function(name,value){fetch(\"" + baseUrl + "/\"+name+\"?value=\"+encodeURIComponent(String(value).slice(0,80)),{mode:\"no-cors\"})};"
  + "send(\"panel-running\"," + JSON.stringify(nextVersion) + ");new window.CSInterface().evalScript(\"getUserFonts()\",function(result){send(\"photoshop-call\",String(result).length+\" characters\")})},5000)</script></head>";
entries["web/index.html"] = strToU8(Buffer.from(entries["web/index.html"]).toString("utf8").replace("</head>", report));
const packageBytes = Buffer.from(zipSync(entries, { level: 6 }));

const server = http.createServer((request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Cache-Control", "no-store");
  console.log("[uxp-update-test] " + request.method + " " + request.url);
  if (request.url === "/releases") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify([{
      tag_name: nextVersion,
      name: "TypeR " + nextVersion + " (local update test)",
      draft: false,
      prerelease: false,
      published_at: new Date().toISOString(),
      body_html: "<p>Local test, no release was published.</p>",
      assets: [{ name: "TypeR-UXP.ccx", browser_download_url: baseUrl + "/TypeR-UXP.ccx" }],
    }]));
    return;
  }
  if (request.url === "/TypeR-UXP.ccx") {
    response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": packageBytes.length });
    response.end(packageBytes);
    return;
  }
  response.writeHead(200);
  response.end();
});

server.listen(port, "127.0.0.1", () => {
  fs.writeFileSync(testFile, JSON.stringify({
    enabled: true,
    releasesUrl: baseUrl + "/releases",
    currentVersion: manifest.version,
    autoInstall: true,
    forceManualPluginInstall: manual,
  }, null, 2));
  console.log("Serving TypeR " + nextVersion + " at " + baseUrl + ", test file: " + testFile);
  console.log("Reinstall TypeR " + manifest.version + " with its panel open, or restart Photoshop: the panel updates itself.");
  console.log(manual ? "Then restart Photoshop." : "Success: /panel-running and /photoshop-call appear here, without a restart.");
});

const stop = () => {
  try {
    fs.unlinkSync(testFile);
  } catch (error) {
    // The panel removes it when it starts the update
  }
  server.close(() => process.exit(0));
  server.closeAllConnections && server.closeAllConnections();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
