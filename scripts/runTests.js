const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const tests = fs.readdirSync(__dirname).filter(name => /^test.*\.js$/.test(name) && name !== 'testBuildArtifacts.js').sort();
for (const name of tests) {
  const result = spawnSync(process.execPath, [path.join(__dirname, name)], { stdio: 'inherit' });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
console.log(tests.length + ' test suites passed');
