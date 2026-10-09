const MAX_STYLE_SIZE_PRESETS = 3;

const parseStyleSize = (value) => {
  const size = parseFloat(value);
  return Number.isFinite(size) && size > 0 ? size : null;
};

const parsePageWidth = (value) => {
  const width = parseFloat(value);
  return Number.isFinite(width) && width > 0 ? Math.round(width) : null;
};

const getStyleTextSize = (style) => parseStyleSize(
  style?.textProps?.layerText?.textStyleRange?.[0]?.textStyle?.size
);

const normalizeStyleSizePresets = (style) => {
  const activeSize = getStyleTextSize(style);
  const source = Array.isArray(style?.sizePresets) ? style.sizePresets : [];
  const presets = [];

  source.forEach((value) => {
    const size = parseStyleSize(value);
    if (size === null || presets.includes(size) || presets.length >= MAX_STYLE_SIZE_PRESETS) return;
    presets.push(size);
  });

  if (activeSize !== null && !presets.includes(activeSize)) {
    if (presets.length >= MAX_STYLE_SIZE_PRESETS) presets.pop();
    presets.unshift(activeSize);
  }

  return presets.length ? presets : (activeSize === null ? [] : [activeSize]);
};

const normalizeStyleSizePresetWidthConfig = (style) => {
  const presets = normalizeStyleSizePresets(style);
  let defaultIndex = parseInt(style?.sizePresetDefaultIndex, 10);
  if (!Number.isFinite(defaultIndex) || defaultIndex < 0 || defaultIndex >= presets.length) {
    defaultIndex = 0;
  }
  const source = Array.isArray(style?.sizePresetMinWidths) ? style.sizePresetMinWidths : [];
  const minWidths = presets.map((_, index) => (
    index === defaultIndex ? null : parsePageWidth(source[index])
  ));
  return {
    autoSizeByPageWidth: style?.autoSizeByPageWidth === true && presets.length > 1,
    sizePresetDefaultIndex: defaultIndex,
    sizePresetMinWidths: minWidths,
  };
};

const resolveStyleSizePresetForPageWidth = (style, pageWidth) => {
  const width = parsePageWidth(pageWidth);
  const presets = normalizeStyleSizePresets(style);
  if (style?.autoSizeByPageWidth !== true || width === null || presets.length < 2) {
    return getStyleTextSize(style);
  }

  const config = normalizeStyleSizePresetWidthConfig(style);
  let selectedSize = presets[config.sizePresetDefaultIndex] || presets[0];
  let selectedThreshold = -1;
  config.sizePresetMinWidths.forEach((threshold, index) => {
    if (index === config.sizePresetDefaultIndex || threshold === null) return;
    if (width >= threshold && threshold > selectedThreshold) {
      selectedThreshold = threshold;
      selectedSize = presets[index];
    }
  });
  return selectedSize;
};

const writeStyleTextSize = (style, size, presets) => {
  const textStyleRange = style?.textProps?.layerText?.textStyleRange;
  if (!textStyleRange?.[0]?.textStyle) return style;

  const textProps = { ...style.textProps };
  const layerText = { ...textProps.layerText };
  const nextRanges = textStyleRange.concat([]);
  const firstRange = { ...nextRanges[0] };
  const textStyle = { ...firstRange.textStyle, size };
  if (textStyle.impliedFontSize != null) textStyle.impliedFontSize = size;
  firstRange.textStyle = textStyle;
  nextRanges[0] = firstRange;
  layerText.textStyleRange = nextRanges;
  textProps.layerText = layerText;

  return { ...style, sizePresets: presets, textProps, edited: Date.now() };
};

const setStyleSizePreset = (style, requestedSize) => {
  const size = parseStyleSize(requestedSize);
  if (size === null) return style;
  const presets = normalizeStyleSizePresets(style);
  if (!presets.includes(size)) return style;
  const storedPresets = Array.isArray(style.sizePresets) ? style.sizePresets : [];
  if (
    getStyleTextSize(style) === size &&
    storedPresets.length === presets.length &&
    storedPresets.every((value, index) => parseStyleSize(value) === presets[index])
  ) return style;
  return writeStyleTextSize(style, size, presets);
};

const updateActiveStyleSizePreset = (style, requestedSize) => {
  const size = parseStyleSize(requestedSize);
  const presets = normalizeStyleSizePresets(style);
  const activeSize = getStyleTextSize(style);
  if (size === null || !presets.length) return style;
  let activeIndex = presets.indexOf(activeSize);
  if (activeIndex < 0) activeIndex = 0;
  if (presets.some((preset, index) => index !== activeIndex && preset === size)) return style;
  if (presets[activeIndex] === size) return style;
  const nextPresets = presets.concat([]);
  nextPresets[activeIndex] = size;
  return writeStyleTextSize(style, size, nextPresets);
};

// A stored bubble selection remembers the size its style had when it was
// captured, so picking another size afterwards only affects the bubbles
// captured later. The captured size is explicit: the page-width rule must not
// override it.
const applyCapturedTextSize = (style, capturedSize) => {
  const size = parseStyleSize(capturedSize);
  if (!style || size === null || getStyleTextSize(style) === size) return style;
  const textStyleRange = style.textProps?.layerText?.textStyleRange;
  if (!textStyleRange?.[0]?.textStyle) return style;

  const textProps = { ...style.textProps };
  const layerText = { ...textProps.layerText };
  const nextRanges = textStyleRange.concat([]);
  const firstRange = { ...nextRanges[0] };
  const textStyle = { ...firstRange.textStyle, size };
  if (textStyle.impliedFontSize != null) textStyle.impliedFontSize = size;
  firstRange.textStyle = textStyle;
  nextRanges[0] = firstRange;
  layerText.textStyleRange = nextRanges;
  textProps.layerText = layerText;
  return { ...style, textProps, autoSizeByPageWidth: false };
};

const cycleStyleSizePreset = (style) => {
  const presets = normalizeStyleSizePresets(style);
  if (presets.length < 2) return style;
  const activeSize = getStyleTextSize(style);
  const activeIndex = presets.indexOf(activeSize);
  const nextIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % presets.length;
  return setStyleSizePreset(style, presets[nextIndex]);
};

export {
  MAX_STYLE_SIZE_PRESETS,
  parseStyleSize,
  parsePageWidth,
  getStyleTextSize,
  normalizeStyleSizePresets,
  normalizeStyleSizePresetWidthConfig,
  resolveStyleSizePresetForPageWidth,
  setStyleSizePreset,
  updateActiveStyleSizePreset,
  applyCapturedTextSize,
  cycleStyleSizePreset,
};
