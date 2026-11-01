// Packs Releases/TypeR-debug.zip after `npm run package:uxp:trace`: what to send
// to a Windows user whose UXP panel stays empty. One double click installs the
// trace build through the regular installer and writes a report (docs/uxp.md).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { zipSync } = require("fflate");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file));
const crlf = (buffer) => Buffer.from(buffer.toString("utf8").replace(/\r?\n/g, "\r\n"), "utf8");

const zip = zipSync({
  "TypeR-debug/TypeR-debug.cmd": crlf(read("scripts/debug-kit/TypeR-debug.cmd")),
  "TypeR-debug/installer/collect.ps1": crlf(read("scripts/debug-kit/collect.ps1")),
  // As it is: its BOM and accents matter to PowerShell 5.1
  "TypeR-debug/installer/install.ps1": read("installer/install.ps1"),
  "TypeR-debug/TypeR-UXP-trace.ccx": read("Releases/TypeR-UXP-trace.ccx"),
}, { level: 9 });

const target = path.join(root, "Releases/TypeR-debug.zip");
fs.writeFileSync(target, zip);
console.log("Debug kit ready: Releases/TypeR-debug.zip (" + zip.length + " bytes, sha256 " + crypto.createHash("sha256").update(zip).digest("hex") + ")");
