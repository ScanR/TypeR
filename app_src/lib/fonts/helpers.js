const fs = require('fs');
const path = require('path');
const fontManager = require('fontmanager-redux');

function findFontFile(psName) {
  const f = fontManager.findFontSync({ postscriptName: psName });
  return f && f.path ? f.path : null;
}

function copyFonts(psNames, destDir) {
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const copied = [];
  psNames.forEach(ps => {
    const src = findFontFile(ps);
    if (src) {
      const target = path.join(destDir, path.basename(src));
      fs.copyFileSync(src, target);
      copied.push(target);
    }
  });
  return copied;
}

module.exports = { findFontFile, copyFonts };
