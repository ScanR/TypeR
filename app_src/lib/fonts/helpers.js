const fs = require('fs');
const path = require('path');
const systemFontPaths = require('system-font-paths');
const fontkit = require('fontkit');

let fontMapPromise;

async function getFontMap() {
  if (!fontMapPromise) {
    fontMapPromise = systemFontPaths().then((paths) => {
      const map = {};
      paths.forEach((p) => {
        try {
          const font = fontkit.openSync(p);
          if (font && font.postscriptName) {
            map[font.postscriptName] = p;
          }
        } catch (e) {
          /* ignore unreadable fonts */
        }
      });
      return map;
    });
  }
  return fontMapPromise;
}
async function findFontFile(psName) {
  const map = await getFontMap();
  return map[psName] || null;
}

async function copyFonts(psNames, destDir) {
  const map = await getFontMap();
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const copied = [];
  psNames.forEach((ps) => {
    const src = map[ps];
    if (src && fs.existsSync(src)) {
      const target = path.join(destDir, path.basename(src));
      fs.copyFileSync(src, target);
      copied.push(target);
    }
  });
  return copied;
}

module.exports = { findFontFile, copyFonts };
