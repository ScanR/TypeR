// Build a standalone UXP script from the exact production host modules.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const style = fs.readFileSync(path.join(root, 'uxp-src/text-style.js'), 'utf8');
const host = fs.readFileSync(path.join(root, 'uxp-src/photoshop.js'), 'utf8');
const checks = fs.readFileSync(path.join(__dirname, 'native-smoke-body.js'), 'utf8');
const script = `const nativeRequire = require;
const styleModule = {exports: {}};
(function(module) {${style}\n})(styleModule);
const hostModule = {exports: {}};
(function(module, require) {${host}\n})(hostModule, name => name === './text-style' ? styleModule.exports : nativeRequire(name));
${checks}`;
fs.writeFileSync(path.join(__dirname, 'native-smoke.psjs'), script);
console.log('Built validation/native-smoke.psjs from current UXP source.');
