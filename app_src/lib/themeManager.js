const setThemeProperty = (name, value) => {
    if (value === null) document.documentElement.style.removeProperty(name);
    else document.documentElement.style.setProperty(name, value);
    if (window.typerLegacyCSSVariable) window.typerLegacyCSSVariable(name, value);
};
import './CSInterface';

import LightTheme from './topcoat/css/topcoat-desktop-light.min.css';
import DarkTheme from './topcoat/css/topcoat-desktop-dark.min.css';
import { readStorage } from '../utils';
import {
    getBackgroundImageMeta,
    getEditorThemePreset,
    normalizeEditorTheme,
    normalizePageLineColor,
    setBackgroundImageMeta,
    setCustomEditorThemes,
} from '../themePresets';
import {
    computeBackgroundLayout,
    normalizeBackgroundImage,
    readBackgroundImageData,
} from '../backgroundImage';

// The theme registry has to be filled before the very first lookup: this module
// runs before the React context is created, and both read the same storage.
setCustomEditorThemes(readStorage("customThemes"));
setBackgroundImageMeta(normalizeBackgroundImage(readStorage("backgroundImage")));

let currentAppSkinInfo = null;
let currentEditorTheme = normalizeEditorTheme(readStorage("editorTheme"));
let currentPageLineColor = normalizePageLineColor(readStorage("pageLineColor"));
let currentBackground = null;
let backgroundLayer = null;
let backgroundImageElement = null;
let backgroundTintElement = null;
let backgroundResizeFrame = null;

function computeValue(value, delta) {
    var computedValue = !isNaN(delta) ? value + delta : value;
    if (computedValue < 0) {
        computedValue = 0;
    } else if (computedValue > 255) {
        computedValue = 255;
    }
    computedValue = Math.floor(computedValue);
    computedValue = computedValue.toString(16);
    return computedValue.length === 1 ? "0" + computedValue : computedValue;
}

function toHex(color, delta) {
    var hex = "";
    if (color) {
        hex = computeValue(color.red, delta) + computeValue(color.green, delta) + computeValue(color.blue, delta);
    }
    return hex;
}

function addRule(stylesheetId, selector, rule) {
    var stylesheet = document.getElementById(stylesheetId);
    if (stylesheet) {
        stylesheet = stylesheet.sheet;
        if (stylesheet.addRule) {
            stylesheet.addRule(selector, rule);
        } else if (stylesheet.insertRule) {
            stylesheet.insertRule(selector + ' { ' + rule + ' }', stylesheet.cssRules.length);
        }
    }
}

function setBodyThemeMode(mode) {
    if (mode === "light") {
        document.body.classList.remove('dark-theme');
        document.body.classList.add('light-theme');
    } else {
        document.body.classList.remove('light-theme');
        document.body.classList.add('dark-theme');
    }
}

// The background picture is a fixed layer behind everything (negative z-index),
// so no panel needs to know about it: the themes above simply use translucent
// surfaces to let it show through.
function ensureBackgroundLayer() {
    if (backgroundLayer) return;
    backgroundLayer = document.createElement("div");
    backgroundLayer.className = "app-bg-layer";
    backgroundImageElement = document.createElement("div");
    backgroundImageElement.className = "app-bg-layer-image";
    backgroundTintElement = document.createElement("div");
    backgroundTintElement.className = "app-bg-layer-tint";
    backgroundLayer.appendChild(backgroundImageElement);
    backgroundLayer.appendChild(backgroundTintElement);
    document.body.insertBefore(backgroundLayer, document.body.firstChild);
}

function layoutBackgroundImage() {
    if (!currentBackground || !backgroundImageElement) return;
    const meta = currentBackground.meta;
    // The blurred layer is oversized so the blur never fades out at the edges
    const pad = Math.round(meta.blur * 2);
    const layout = computeBackgroundLayout(
        window.innerWidth + pad * 2,
        window.innerHeight + pad * 2,
        meta.width,
        meta.height,
        meta.crop
    );
    ["top", "right", "bottom", "left"].forEach(side => { backgroundImageElement.style[side] = `${-pad}px`; });
    backgroundImageElement.style.backgroundSize = layout.backgroundSize;
    backgroundImageElement.style.backgroundPosition = layout.backgroundPosition;
}

function onBackgroundResize() {
    if (backgroundResizeFrame) return;
    backgroundResizeFrame = window.requestAnimationFrame(function () {
        backgroundResizeFrame = null;
        layoutBackgroundImage();
    });
}

function applyBackgroundLayer(preset) {
    const meta = preset && preset.image ? getBackgroundImageMeta() : null;
    const data = meta ? readBackgroundImageData() : null;

    if (!meta || !data) {
        currentBackground = null;
        document.documentElement.classList.remove("m-typer-bg");
        if (backgroundLayer) backgroundLayer.style.display = "none";
        window.removeEventListener("resize", onBackgroundResize);
        return;
    }

    ensureBackgroundLayer();
    currentBackground = { meta, data };
    backgroundLayer.style.display = "";
    backgroundImageElement.style.backgroundImage = `url("${data}")`;
    backgroundImageElement.style.opacity = String(meta.opacity);
    backgroundImageElement.style.filter = meta.blur ? `blur(${meta.blur}px)` : "none";
    backgroundTintElement.style.background = (preset.background && preset.background.tint) || "transparent";
    setThemeProperty(
        "--typer-bg-base",
        (preset.background && preset.background.base) || "#1e1e1e"
    );
    document.documentElement.classList.add("m-typer-bg");
    layoutBackgroundImage();
    window.removeEventListener("resize", onBackgroundResize);
    window.addEventListener("resize", onBackgroundResize);
}

function applyPageLineColor(color) {
    currentPageLineColor = normalizePageLineColor(color);
    if (currentPageLineColor) {
        setThemeProperty("--typer-page-line-color", currentPageLineColor);
        document.body.classList.add("m-page-line-custom");
    } else {
        setThemeProperty("--typer-page-line-color", null);
        document.body.classList.remove("m-page-line-custom");
    }
}

function applyEditorTheme(id) {
    currentEditorTheme = normalizeEditorTheme(id);
    var preset = getEditorThemePreset(currentEditorTheme);
    applyBackgroundLayer(preset);
    var mode = preset.mode;
    if (mode === "system") {
        if (currentAppSkinInfo) updateThemeWithAppSkinInfo(currentAppSkinInfo);
        return;
    }

    var topcoatCSS = document.getElementById('topcoat');
    topcoatCSS.href = mode === "light" ? LightTheme : DarkTheme;
    setBodyThemeMode(mode);
    document.body.setAttribute("data-editor-theme", preset.id);
    document.documentElement.setAttribute("data-editor-theme", preset.id);

    var colors = preset.colors || {};
    Object.keys(colors).forEach(function (key) {
        setThemeProperty("--editor-" + key, colors[key]);
    });
}

// Single entry point used by the app: keeps the theme registry, the page line
// override and the background layer in sync with the stored settings.
function applyThemeState(state) {
    var settings = state || {};
    setCustomEditorThemes(settings.customThemes);
    setBackgroundImageMeta(normalizeBackgroundImage(settings.backgroundImage));
    applyPageLineColor(settings.pageLineColor);
    applyEditorTheme(settings.editorTheme);
}

function updateThemeWithAppSkinInfo(appSkinInfo) {
    currentAppSkinInfo = appSkinInfo;

    var panelBgColor = appSkinInfo.panelBackgroundColor.color;
    var lightBgdColor = toHex(panelBgColor, 20);
    var darkBgdColor = toHex(panelBgColor, -20);
    var bgdColor = toHex(panelBgColor);
    var isLight = panelBgColor.red >= 125;
    var fontColor = isLight ? "000000" : "F0F0F0";
    var styleId = "hostStyle";

    addRule(styleId, ".hostElt", "background-color: #" + bgdColor);
    addRule(styleId, ".hostElt", "font-size: " + appSkinInfo.baseFontSize + "px;");
    addRule(styleId, ".hostElt", "font-family: " + appSkinInfo.baseFontFamily);
    addRule(styleId, ".hostElt", "color: #" + fontColor);

    addRule(styleId, ".hostBgd", "background-color: #" + bgdColor);
    addRule(styleId, ".hostBgdDark", "background-color: #" + darkBgdColor);
    addRule(styleId, ".hostBgdLight", "background-color: #" + lightBgdColor);

    addRule(styleId, ".hostBrd", "border: 1px solid #" + bgdColor);
    addRule(styleId, ".hostBrdDark", "border: 1px solid #" + darkBgdColor);
    addRule(styleId, ".hostBrdLight", "border: 1px solid #" + lightBgdColor);
    addRule(styleId, ".hostBrdContrast", "border: 1px solid rgba(" + (isLight ? "0, 0, 0" : "255, 255, 255") + ", 0.2)");
    addRule(styleId, ".hostBrdTop", "border-top: 1px solid #" + bgdColor);
    addRule(styleId, ".hostBrdTopDark", "border-top: 1px solid #" + darkBgdColor);
    addRule(styleId, ".hostBrdTopLight", "border-top: 1px solid #" + lightBgdColor);
    addRule(styleId, ".hostBrdTopContrast", "border-top: 1px solid rgba(" + (isLight ? "0, 0, 0" : "255, 255, 255") + ", 0.2)");
    addRule(styleId, ".hostBrdBot", "border-bottom: 1px solid #" + bgdColor);
    addRule(styleId, ".hostBrdBotDark", "border-bottom: 1px solid #" + darkBgdColor);
    addRule(styleId, ".hostBrdBotLight", "border-bottom: 1px solid #" + lightBgdColor);
    addRule(styleId, ".hostBrdBotContrast", "border-bottom: 1px solid rgba(" + (isLight ? "0, 0, 0" : "255, 255, 255") + ", 0.2)");

    addRule(styleId, ".hostFontSize", "font-size: " + appSkinInfo.baseFontSize + "px;");
    addRule(styleId, ".hostFontFamily", "font-family: " + appSkinInfo.baseFontFamily);
    addRule(styleId, ".hostFontColor", "color: #" + fontColor);
    addRule(styleId, ".hostFont", "font-size: " + appSkinInfo.baseFontSize + "px;");
    addRule(styleId, ".hostFont", "font-family: " + appSkinInfo.baseFontFamily);
    addRule(styleId, ".hostFont", "color: #" + fontColor);

    addRule(styleId, ".hostButton", "background-color: #" + darkBgdColor);
    addRule(styleId, ".hostButton:hover", "background-color: #" + bgdColor);
    addRule(styleId, ".hostButton:active", "background-color: #" + darkBgdColor);
    addRule(styleId, ".hostButton", "border-color: #" + lightBgdColor);

    if (currentEditorTheme === "system") {
        var topcoatCSS = document.getElementById('topcoat');
        topcoatCSS.href = isLight ? LightTheme : DarkTheme;
        setBodyThemeMode(isLight ? "light" : "dark");
        document.body.setAttribute("data-editor-theme", "system");
        document.documentElement.setAttribute("data-editor-theme", "system");
    }
}

function onAppThemeColorChanged() {
    var skinInfo = JSON.parse(window.__adobe_cep__.getHostEnvironment()).appSkinInfo;
    updateThemeWithAppSkinInfo(skinInfo);
}

const csInterface = new window.CSInterface();
updateThemeWithAppSkinInfo(csInterface.hostEnvironment.appSkinInfo);
csInterface.addEventListener(window.CSInterface.THEME_COLOR_CHANGED_EVENT, onAppThemeColorChanged);
applyPageLineColor(currentPageLineColor);
if (currentEditorTheme !== "system") applyEditorTheme(currentEditorTheme);

export { applyEditorTheme, applyThemeState, applyPageLineColor };
