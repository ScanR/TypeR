// Build a standalone UXP script from the exact production host modules.
// Usage: node validation/build-native-smoke.js [output folder]
// The report and test PSD are written to the output folder (default: this
// validation folder). UXP scripts cannot resolve their own location, so the
// folder is embedded as an absolute file: URL at build time.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const root = path.resolve(__dirname, '..');
const outputFolder = path.resolve(process.argv[2] || __dirname);
fs.mkdirSync(outputFolder, { recursive: true });
// UXP expects "file:/abs/path" (single slash) for getEntryWithUrl
const folderUrl = pathToFileURL(outputFolder).href.replace(/^file:\/\//, 'file:');
const style = fs.readFileSync(path.join(root, 'uxp-src/text-style.js'), 'utf8');
const host = fs.readFileSync(path.join(root, 'uxp-src/photoshop.js'), 'utf8');
const checks = fs.readFileSync(path.join(__dirname, 'native-smoke-body.js'), 'utf8');
const script = `const VALIDATION_FOLDER_URL = ${JSON.stringify(folderUrl)};
const nativeRequire = require;
const styleModule = {exports: {}};
(function(module) {${style}\n})(styleModule);
const hostModule = {exports: {}};
(function(module, require) {${host}\n})(hostModule, name => name === './text-style' ? styleModule.exports : nativeRequire(name));
${checks}`;
fs.writeFileSync(path.join(__dirname, 'native-smoke.psjs'), script);
console.log(`Built validation/native-smoke.psjs from current UXP source; results go to ${outputFolder}`);
