import "./lib/CSInterface";

const csInterface = new window.CSInterface();
const path = csInterface.getSystemPath(window.SystemPath.EXTENSION);
const storagePath = path + "/storage";

let locale = {};

const openUrl = window.cep.util.openURLInDefaultBrowser;

const checkUpdate = async (currentVersion) => {
  try {
    const response = await fetch(
      "https://api.github.com/repos/ScanR/TypeR/releases/latest",
      { headers: { Accept: "application/vnd.github.v3.html+json" } }
    );
    if (!response.ok) return null;
    const data = await response.json();
    if (data.tag_name && data.tag_name !== currentVersion) {
      return { version: data.tag_name, body: data.body_html || data.body };
    }
  } catch (e) {
    console.error("Update check failed", e);
  }
  return null;
};

const readStorage = (key) => {
  const result = window.cep.fs.readFile(storagePath);
  if (result.err) {
    return key
      ? void 0
      : {
          error: result.err,
          data: {},
        };
  } else {
    const data = JSON.parse(result.data || "{}") || {};
    return key ? data[key] : { data };
  }
};

const writeToStorage = (data, rewrite) => {
  const storage = readStorage();
  if (storage.error || rewrite) {
    const result = window.cep.fs.writeFile(storagePath, JSON.stringify(data));
    return !result.err;
  } else {
    data = Object.assign({}, storage.data, data);
    const result = window.cep.fs.writeFile(storagePath, JSON.stringify(data));
    return !result.err;
  }
};

const parseLocaleFile = (str) => {
  const result = {};
  if (!str) return result;
  const lines = str.replace(/\r/g, "").split("\n");
  let key = null;
  let val = "";
  for (let line of lines) {
    if (line.startsWith("#")) continue;
    if (key) {
      val += line;
      if (val.endsWith("\\")) {
        val = val.slice(0, -1) + "\n";
        continue;
      }
      result[key] = val;
      key = null;
      val = "";
      continue;
    }
    const i = line.indexOf("=");
    if (i === -1) continue;
    key = line.slice(0, i).trim();
    val = line.slice(i + 1);
    if (val.endsWith("\\")) {
      val = val.slice(0, -1) + "\n";
      continue;
    }
    result[key] = val;
    key = null;
    val = "";
  }
  return result;
};

const initLocale = () => {
  locale = csInterface.initResourceBundle();
  const lang = readStorage("language");
  if (lang && lang !== "auto") {
    const file =
      lang === "en_US"
        ? `${path}/locale/messages.properties`
        : `${path}/locale/${lang}/messages.properties`;
    const result = window.cep.fs.readFile(file);
    if (!result.err) {
      const data = parseLocaleFile(result.data);
      locale = Object.assign(locale, data);
    }
  }
};

initLocale();

const nativeAlert = (text, title, isError) => {
  const data = JSON.stringify({ text, title, isError });
  csInterface.evalScript("nativeAlert(" + data + ")");
};

const nativeConfirm = (text, title, callback) => {
  const data = JSON.stringify({ text, title });
  csInterface.evalScript("nativeConfirm(" + data + ")", (result) => callback(!!result));
};

let userFonts = null;
const getUserFonts = () => {
  return Array.isArray(userFonts) ? userFonts.concat([]) : [];
};
if (!userFonts) {
  csInterface.evalScript("getUserFonts()", (data) => {
    const dataObj = JSON.parse(data || "{}");
    const fonts = dataObj.fonts || [];
    userFonts = fonts;
  });
}

const getActiveLayerText = (callback) => {
  csInterface.evalScript("getActiveLayerText()", (data) => {
    const dataObj = JSON.parse(data || "{}");
    if (!data || !dataObj.textProps) nativeAlert(locale.errorNoTextLayer, locale.errorTitle, true);
    else callback(dataObj);
  });
};

const setActiveLayerText = (text, style, callback = () => {}) => {
  if (!text && !style) {
    nativeAlert(locale.errorNoTextNoStyle, locale.errorTitle, true);
    callback(false);
    return false;
  }
  const data = JSON.stringify({ text, style });
  csInterface.evalScript("setActiveLayerText(" + data + ")", (error) => {
    if (error) nativeAlert(locale.errorNoTextLayer, locale.errorTitle, true);
    callback(!error);
  });
};

const createTextLayerInSelection = (text, style, pointText, callback = () => {}) => {
  if (!text) {
    nativeAlert(locale.errorNoText, locale.errorTitle, true);
    callback(false);
    return false;
  }
  if (!style) {
    style = { textProps: getDefaultStyle(), stroke: getDefaultStroke() };
  }
  const data = JSON.stringify({ text, style });
  csInterface.evalScript("createTextLayerInSelection(" + data + ", " + !!pointText + ")", (error) => {
    if (error === "smallSelection") nativeAlert(locale.errorSmallSelection, locale.errorTitle, true);
    else if (error) nativeAlert(locale.errorNoSelection, locale.errorTitle, true);
    callback(!error);
  });
};

const alignTextLayerToSelection = (convert) => {
  csInterface.evalScript("alignTextLayerToSelection(" + !!convert + ")", (error) => {
    if (error === "smallSelection") nativeAlert(locale.errorSmallSelection, locale.errorTitle, true);
    else if (error === "noSelection") nativeAlert(locale.errorNoSelection, locale.errorTitle, true);
    else if (error) nativeAlert(locale.errorNoTextLayer, locale.errorTitle, true);
  });
};

const changeActiveLayerTextSize = (val, callback = () => {}) => {
  csInterface.evalScript("changeActiveLayerTextSize(" + val + ")", (error) => {
    if (error) nativeAlert(locale.errorNoTextLayer, locale.errorTitle, true);
    callback(!error);
  });
};

const getHotkeyPressed = (callback) => {
  csInterface.evalScript("getHotkeyPressed()", callback);
};

const resizeTextArea = () => {
  const textArea = document.querySelector(".text-area");
  const textLines = document.querySelector(".text-lines");
  if (textArea && textLines) {
    textArea.style.height = textLines.offsetHeight + "px";
  }
};

const scrollToLine = (lineIndex, delay = 300) => {
  lineIndex = lineIndex < 5 ? 0 : lineIndex - 5;
  setTimeout(() => {
    const line = document.querySelectorAll(".text-line")[lineIndex];
    if (line) line.scrollIntoView();
  }, delay);
};

const scrollToStyle = (styleId, delay = 100) => {
  setTimeout(() => {
    const style = document.getElementById(styleId);
    if (style) style.scrollIntoView();
  }, delay);
};

const rgbToHex = (rgb = {}) => {
  const componentToHex = (c = 0) => ("0" + Math.round(c).toString(16)).substr(-2).toUpperCase();
  const r = rgb.red != null ? rgb.red : rgb.r;
  const g = rgb.green != null ? rgb.green : rgb.g;
  const b = rgb.blue != null ? rgb.blue : rgb.b;
  return "#" + componentToHex(r) + componentToHex(g) + componentToHex(b);
};

const getStyleObject = (textStyle) => {
  const styleObj = {};
  if (textStyle.fontName) styleObj.fontFamily = textStyle.fontName;
  if (textStyle.fontPostScriptName) styleObj.fontFileFamily = textStyle.fontPostScriptName;
  if (textStyle.syntheticBold) styleObj.fontWeight = "bold";
  if (textStyle.syntheticItalic) styleObj.fontStyle = "italic";
  if (textStyle.fontCaps === "allCaps") styleObj.textTransform = "uppercase";
  if (textStyle.fontCaps === "smallCaps") styleObj.textTransform = "lowercase";
  if (textStyle.underline && textStyle.underline !== "underlineOff") styleObj.textDecoration = "underline";
  if (textStyle.strikethrough && textStyle.strikethrough !== "strikethroughOff") {
    if (styleObj.textDecoration) styleObj.textDecoration += " line-through";
    else styleObj.textDecoration = "line-through";
  }
  return styleObj;
};

const getDefaultStyle = () => {
  return {
    layerText: {
      textGridding: "none",
      orientation: "horizontal",
      antiAlias: "antiAliasSmooth",
      textStyleRange: [
        {
          from: 0,
          to: 100,
          textStyle: {
            fontPostScriptName: "Tahoma",
            fontName: "Tahoma",
            fontStyleName: "Regular",
            fontScript: 0,
            fontTechnology: 1,
            fontAvailable: true,
            size: 14,
            impliedFontSize: 14,
            horizontalScale: 100,
            verticalScale: 100,
            autoLeading: true,
            tracking: 0,
            baselineShift: 0,
            impliedBaselineShift: 0,
            autoKern: "metricsKern",
            fontCaps: "normal",
            digitSet: "defaultDigits",
            markYDistFromBaseline: 100,
            otbaseline: "normal",
            ligature: false,
            altligature: false,
            connectionForms: false,
            contextualLigatures: false,
            baselineDirection: "withStream",
            color: { red: 0, green: 0, blue: 0 },
          },
        },
      ],
      paragraphStyleRange: [
        {
          from: 0,
          to: 100,
          paragraphStyle: {
            burasagari: "burasagariNone",
            singleWordJustification: "justifyAll",
            justificationMethodType: "justifMethodAutomatic",
            textEveryLineComposer: false,
            alignment: "center",
            hangingRoman: true,
            hyphenate: true,
          },
        },
      ],
    },
    typeUnit: "pixelsUnit",
  };
};

const getDefaultStroke = () => {
  return {
    enabled: false,
    size: 0,
    opacity: 100,
    position: "outer",
    color: { r: 255, g: 255, b: 255 },
  };
};

const openFile = (path, autoClose = false) => {
  const encodedPath = JSON.stringify(path);
  csInterface.evalScript(
    "openFile(" + encodedPath + ", " + (autoClose ? "true" : "false") + ")"
  );
};

export { csInterface, locale, openUrl, readStorage, writeToStorage, nativeAlert, nativeConfirm, getUserFonts, getActiveLayerText, setActiveLayerText, createTextLayerInSelection, alignTextLayerToSelection, changeActiveLayerTextSize, getHotkeyPressed, resizeTextArea, scrollToLine, scrollToStyle, rgbToHex, getStyleObject, getDefaultStyle, getDefaultStroke, openFile, checkUpdate };
