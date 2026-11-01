const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function compile(args, directory) {
  if (process.platform !== "win32") throw new Error("The keyboard addon prototype builds on Windows x64");
  const vswhere = path.join(process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)", "Microsoft Visual Studio/Installer/vswhere.exe");
  const installation = execFileSync(vswhere, ["-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"], { encoding: "utf8" }).trim();
  if (!installation) throw new Error("Install Visual Studio C++ Build Tools and the Windows SDK");
  const setup = path.join(installation, "Common7/Tools/VsDevCmd.bat");
  const quote = (value) => {
    if (/[\r\n"]/.test(value)) throw new Error("Invalid compiler argument");
    return '"' + value.replace(/%/g, "%%") + '"';
  };
  fs.mkdirSync(directory, { recursive: true });
  const command = path.join(directory, "compile.cmd");
  fs.writeFileSync(command, [
    "@echo off", "setlocal DisableDelayedExpansion",
    "call " + quote(setup) + " -no_logo -arch=x64 -host_arch=x64",
    "if errorlevel 1 exit /b %errorlevel%",
    "cl.exe " + args.map(quote).join(" "),
    "exit /b %errorlevel%", "",
  ].join("\r\n"));
  // VsDevCmd invokes vswhere by name on some installations.
  const env = Object.assign({}, process.env);
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") || "Path";
  env[pathKey] = path.dirname(vswhere) + path.delimiter + (env[pathKey] || "");
  execFileSync("cmd.exe", ["/d", "/c", ".\\compile.cmd"], { cwd: directory, stdio: "inherit", env });
}

module.exports = { compile };
