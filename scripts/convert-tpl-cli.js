const fs = require('fs');
const path = require('path');

function hexToText(hex) {
  return (hex.match(/.{2}/g) || [])
    .map(byte => String.fromCharCode(parseInt(byte, 16)))
    .join('')
    .replace(/[^\x20-\x7E]+/g, '') || '';
}

function generateId() {
  return Math.random().toString(36).substring(2, 8);
}

function extractActionDescriptorString(cleanHex, keyIndex, keyHexLength) {
  const lenPos = keyIndex + keyHexLength;
  const lenHex = cleanHex.slice(lenPos, lenPos + 8);
  const strLen = parseInt(lenHex, 16);
  if (!isNaN(strLen) && strLen > 0 && strLen < 300) {
    const utf16Hex = cleanHex.slice(lenPos + 8, lenPos + 8 + strLen * 4);
    const parsedUtf16 = hexToText(utf16Hex).trim();
    if (parsedUtf16 && Math.abs(parsedUtf16.length - strLen) <= 2) {
      return parsedUtf16;
    }

    const asciiHex = cleanHex.slice(lenPos + 8, lenPos + 8 + strLen * 2);
    const parsedAscii = hexToText(asciiHex).trim();
    if (parsedAscii && Math.abs(parsedAscii.length - strLen) <= 2) {
      return parsedAscii;
    }

    if (parsedUtf16) return parsedUtf16;
    if (parsedAscii) return parsedAscii;
  }
  const rawHex = cleanHex.slice(lenPos, lenPos + 240);
  const rawText = hexToText(rawHex);
  return rawText
    .split('TEXT')[0]
    .split('UntF')[0]
    .split('FntN')[0]
    .split('FntS')[0]
    .split('Scrp')[0]
    .split('long')[0]
    .split('enum')[0]
    .split('\0')[0]
    .trim();
}

function convertTplFileToTypeRExport(tplFilePath, outputJsonPath) {
  if (!fs.existsSync(tplFilePath)) {
    console.error(`Error: File not found - ${tplFilePath}`);
    process.exit(1);
  }

  const fileBuffer = fs.readFileSync(tplFilePath);
  const binaryData = Array.from(fileBuffer).map(b => String.fromCharCode(b)).join('');
  
  const hexLookup = new Array(256).fill('').map((_, i) => i.toString(16).padStart(2, '0'));
  const hexData = Array.from(binaryData).map(c => hexLookup[c.charCodeAt(0)]).join('');

  const rawFileName = path.basename(tplFilePath);
  const cleanFolderName = rawFileName.replace(/\.tpl$/i, '').trim() || 'TPL Import';
  const folderId = generateId();

  const folder = {
    name: cleanFolderName,
    id: folderId,
    chosen: false,
    selected: false,
    parentId: null,
    order: 0
  };

  const patterns = {
    start: '00000000001000000001000000000014747970654372656174654f724564697454',
    marker: '000000',
    fontPostScript: '666f6e74506f73745363726970744e616d6554455854',
    fntNTEXT: '466e744e54455854',
    fntSTEXT: '466e745354455854'
  };

  const presetNames = [];
  let pIndex = 0;
  while ((pIndex = hexData.indexOf(patterns.start, pIndex)) !== -1) {
    let markerIndex = pIndex - 6;
    while (markerIndex >= 0) {
      const currentMarker = hexData.slice(markerIndex, markerIndex + 6);
      if (currentMarker === patterns.marker) {
        const nameHex = hexData.slice(markerIndex + 6, pIndex);
        const name = hexToText(nameHex).trim();
        if (name) {
          presetNames.push({ index: pIndex, name });
        }
        break;
      }
      markerIndex -= 2;
    }
    pIndex += patterns.start.length;
  }

  const styles = [];
  let startIndex = 0;
  let fontCount = 0;

  while ((startIndex = hexData.indexOf(patterns.fontPostScript, startIndex)) !== -1) {
    let currentPresetName = `Preset ${fontCount + 1}`;
    for (let i = presetNames.length - 1; i >= 0; i--) {
      if (presetNames[i].index <= startIndex) {
        currentPresetName = presetNames[i].name;
        break;
      }
    }

    const postScriptName = extractActionDescriptorString(hexData, startIndex, patterns.fontPostScript.length);

    const fntNTEXTIndex = hexData.indexOf(patterns.fntNTEXT, startIndex);
    let fontFamily = '';
    let fontStyle = 'Regular';

    if (fntNTEXTIndex !== -1 && fntNTEXTIndex - startIndex < 2000) {
      fontFamily = extractActionDescriptorString(hexData, fntNTEXTIndex, patterns.fntNTEXT.length);
    }
    const fntSTEXTIndex = hexData.indexOf(patterns.fntSTEXT, fntNTEXTIndex !== -1 ? fntNTEXTIndex : startIndex);
    if (fntSTEXTIndex !== -1 && fntSTEXTIndex - startIndex < 2000) {
      fontStyle = extractActionDescriptorString(hexData, fntSTEXTIndex, patterns.fntSTEXT.length) || 'Regular';
    }

    if (!fontFamily) {
      fontFamily = postScriptName.split('-')[0] || 'Myriad Pro';
    }

    const styleId = generateId();
    fontCount++;

    const textStyle = {
      styleSheetHasParent: true,
      fontPostScriptName: postScriptName || `${fontFamily}-${fontStyle}`,
      fontName: fontFamily,
      fontStyleName: fontStyle,
      fontScript: 0,
      fontTechnology: 0,
      fontAvailable: true,
      size: 50,
      impliedFontSize: 50,
      horizontalScale: 100,
      verticalScale: 100,
      syntheticBold: false,
      syntheticItalic: false,
      autoLeading: true,
      tracking: 0,
      baselineShift: 0,
      impliedBaselineShift: 0,
      autoKern: "metricsKern",
      fontCaps: "normal",
      digitSet: "defaultDigits",
      kashidas: "kashidaDefault",
      diacXOffset: 0,
      diacYOffset: 0,
      markYDistFromBaseline: 100,
      baseline: "normal",
      strikethrough: "strikethroughOff",
      underline: "underlineOff",
      ligature: true,
      altligature: true,
      contextualLigatures: false,
      fractions: false,
      ordinals: false,
      swash: false,
      titling: false,
      connectionForms: false,
      stylisticAlternates: false,
      ornaments: false,
      justificationAlternates: false,
      figureStyle: "normal",
      proportionalMetrics: false,
      kana: false,
      italics: false,
      baselineDirection: "withStream",
      textLanguage: "englishLanguage",
      japaneseAlternate: "defaultForm",
      mojiZume: 0,
      gridAlignment: "roman",
      noBreak: false,
      color: { red: 0, green: 0, blue: 0 },
      strokeColor: { red: 0, green: 0, blue: 0 }
    };

    const paragraphStyle = {
      styleSheetHasParent: true,
      alignment: "center",
      firstLineIndent: 0,
      impliedFirstLineIndent: 0,
      startIndent: 0,
      impliedStartIndent: 0,
      endIndent: 0,
      impliedEndIndent: 0,
      spaceBefore: 0,
      impliedSpaceBefore: 0,
      spaceAfter: 0,
      impliedSpaceAfter: 0,
      autoLeadingPercentage: 1.05,
      leadingType: "leadingBelow",
      directionType: "dirLeftToRight",
      kashidaWidthType: "kashidaWidthMedium",
      hyphenate: false,
      justificationWordMinimum: 0.8,
      justificationWordDesired: 1,
      justificationWordMaximum: 1.33,
      justificationLetterMinimum: 0,
      justificationLetterDesired: 0,
      justificationLetterMaximum: 0,
      justificationGlyphMinimum: 1,
      justificationGlyphDesired: 1,
      justificationGlyphMaximum: 1,
      hangingRoman: false,
      burasagari: "burasagariNone",
      preferredKinsokuOrder: "pushIn",
      textEveryLineComposer: false,
      textComposerEngine: "textLatinCJKComposer",
      singleWordJustification: "justifyAll",
      justificationMethodType: "justifMethodAutomatic"
    };

    styles.push({
      name: currentPresetName || `${fontFamily} ${fontStyle}`,
      folder: folderId,
      textType: "inherit",
      textProps: {
        layerText: {
          textGridding: "none",
          orientation: "horizontal",
          antiAlias: "antiAliasSmooth",
          textStyleRange: [
            {
              from: 0,
              to: 6,
              textStyle
            }
          ],
          paragraphStyleRange: [
            {
              from: 0,
              to: 6,
              paragraphStyle
            }
          ],
          kerningRange: []
        },
        typeUnit: "pixelsUnit"
      },
      prefixes: [],
      prefixColor: "#FFF3B0",
      id: styleId,
      edited: Date.now(),
      chosen: false,
      selected: false,
      stroke: {
        enabled: false,
        size: 0,
        opacity: 100,
        position: "outer",
        color: { r: 255, g: 255, b: 255 }
      }
    });

    startIndex += patterns.fontPostScript.length;
  }

  const exportData = {
    folders: [folder],
    styles
  };

  const jsonStr = JSON.stringify(exportData, null, 2);
  const targetPath = outputJsonPath || tplFilePath.replace(/\.tpl$/i, '_Export.json');
  fs.writeFileSync(targetPath, jsonStr, 'utf8');

  console.log(`Successfully transformed ${styles.length} font preset(s) from "${tplFilePath}" to TypeR export format:`);
  console.log(`Saved to: ${targetPath}`);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('Usage: node convert-tpl-cli.js <path-to-file.tpl> [path-to-output.json]');
  process.exit(0);
}

convertTplFileToTypeRExport(args[0], args[1]);
