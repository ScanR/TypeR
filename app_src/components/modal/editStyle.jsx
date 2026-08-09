import "./editStyle.scss";

import React from "react";
import deepClone from "../../deepClone";
import PropTypes from "prop-types";
import { FiCopy, FiX, FiMinus, FiPlus } from "react-icons/fi";
import { TiSortAlphabetically } from "react-icons/ti";
import { GiVerticalFlip, GiHorizontalFlip } from "react-icons/gi";
import { TbAlphabetArabic } from "react-icons/tb";
import { MdDelete, MdCancel, MdSave, MdFormatColorText } from "react-icons/md";
import { GrSubscript, GrSuperscript, GrBlockQuote, GrMonospace } from "react-icons/gr";
import { BsTypeBold, BsTypeItalic, BsFonts, BsType, BsTypeUnderline, BsTypeStrikethrough } from "react-icons/bs";
import { AiOutlineLineHeight, AiOutlineFontSize, AiOutlineColumnHeight, AiOutlineToTop, AiOutlineAlignCenter, AiOutlineAlignLeft, AiOutlineAlignRight } from "react-icons/ai";

import { SketchPicker } from "react-color";

import config from "../../config";
import { locale, nativeAlert, nativeConfirm, getUserFonts, getActiveLayerText, rgbToHex, getDefaultStyle, getDefaultStroke } from "../../utils";
import { useContext } from "../../context";
import { buildFolderTree, flattenFolderTree } from "../../folderUtils";
import {
  MAX_STYLE_SIZE_PRESETS,
  getStyleTextSize,
  normalizeStyleSizePresets,
  normalizeStyleSizePresetWidthConfig,
  parseStyleSize,
} from "../../styleSizePresets";
import FontScanPromo from "./fontScanPromo";
import UnsavedChangesDialog from "./unsavedChangesDialog";

const EditStyleModal = React.memo(function EditStyleModal() {
  const context = useContext((state) => ({
    modalData: state.modalData,
    folders: state.folders,
    styleSizeStep: state.styleSizeStep,
    middleEast: state.middleEast,
  }));
  const currentData = context.state.modalData;
  const [name, setName] = React.useState(currentData.name || "");
  const [folder, setFolder] = React.useState(currentData.folder || "");
  const [textType, setTextType] = React.useState(
    ["point", "paragraph"].includes(currentData.textType) ? currentData.textType : "inherit"
  );
  const [textProps, setTextProps] = React.useState(currentData.textProps || getDefaultStyle());
  const [sizePresets, setSizePresets] = React.useState(() => normalizeStyleSizePresets({
    ...currentData,
    textProps: currentData.textProps || getDefaultStyle(),
  }));
  const initialWidthConfig = normalizeStyleSizePresetWidthConfig({ ...currentData, sizePresets, textProps });
  const [autoSizeByPageWidth, setAutoSizeByPageWidth] = React.useState(initialWidthConfig.autoSizeByPageWidth);
  const [sizePresetDefaultIndex, setSizePresetDefaultIndex] = React.useState(initialWidthConfig.sizePresetDefaultIndex);
  const [sizePresetMinWidths, setSizePresetMinWidths] = React.useState(initialWidthConfig.sizePresetMinWidths);
  const [prefixes, setPrefixes] = React.useState(currentData.prefixes?.join("\n") || "");
  const [prefixColor, setPrefixColor] = React.useState(currentData.prefixColor || config.defaultPrefixColor);
  const [colorPickerOpen, setColorPickerOpen] = React.useState(false);
  const [stroke, setStroke] = React.useState(currentData.stroke || getDefaultStroke());
  const [strokePickerOpen, setStrokePickerOpen] = React.useState(false);
  const [edited, setEdited] = React.useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = React.useState(false);
  const nameInputRef = React.useRef();
  const folderTree = React.useMemo(() => buildFolderTree(context.state.folders), [context.state.folders]);
  const folderOptions = React.useMemo(() => flattenFolderTree(folderTree), [folderTree]);

  const closeModal = () => {
    if (currentData.walkthroughReturn) {
      context.dispatch({
        type: "setModal",
        modal: "walkthrough",
        data: currentData.walkthroughState || { initialStep: 1 },
      });
      return;
    }
    context.dispatch({ type: "setModal" });
  };

  const close = () => {
    if (edited) {
      setDiscardConfirmOpen(true);
      return;
    }
    closeModal();
  };

  const confirmClose = () => {
    setDiscardConfirmOpen(false);
    closeModal();
  };

  const changeStyleName = (e) => {
    setName(e.target.value);
    setEdited(true);
  };

  const changeStyleFolder = (e) => {
    setFolder(e.target.value);
    setEdited(true);
  };

  const changeTextType = (e) => {
    setTextType(e.target.value);
    setEdited(true);
  };

  const copyLayerStyle = () => {
    getActiveLayerText((data) => {
      if (!data.textProps.layerText?.textStyleRange.length) return;
      if (!data.textProps.layerText?.paragraphStyleRange.length) return;
      const firstTextStyle = data.textProps.layerText.textStyleRange[0];
      const firstParStyle = data.textProps.layerText.paragraphStyleRange[0];
      firstParStyle.paragraphStyle.burasagari = firstParStyle.paragraphStyle.burasagari || "burasagariNone";
      firstParStyle.paragraphStyle.singleWordJustification = firstParStyle.paragraphStyle.singleWordJustification || "justifyAll";
      firstParStyle.paragraphStyle.justificationMethodType = firstParStyle.paragraphStyle.justificationMethodType || "justifMethodAutomatic";
      firstParStyle.paragraphStyle.textEveryLineComposer = !!firstParStyle.paragraphStyle.textEveryLineComposer;
      data.textProps.layerText.paragraphStyleRange = [firstParStyle];
      data.textProps.layerText.textStyleRange = [firstTextStyle];
      delete data.textProps.layerText.textKey;
      delete data.textProps.layerText.textShape;
      delete data.textProps.layerText.textClickPoint;
      delete data.textProps.layerText.transform;
      delete data.textProps.layerText.boundingBox;
      delete data.textProps.layerText.bounds;
      delete data.textProps.layerText.warp;
      setTextProps(data.textProps);
      const copiedSize = getStyleTextSize(data);
      if (copiedSize !== null) {
        setSizePresets([copiedSize]);
        setAutoSizeByPageWidth(false);
        setSizePresetDefaultIndex(0);
        setSizePresetMinWidths([null]);
      }
      if (data.textType === "point" || data.textType === "paragraph") {
        setTextType(data.textType);
      }
      if (data.stroke) setStroke(data.stroke);
      setEdited(true);
    });
  };

  const changeTextProps = React.useCallback((newProps) => {
    setTextProps(newProps);
    setEdited(true);
  }, []);

  const changePrefixes = (e) => {
    setPrefixes(e.target.value);
    setEdited(true);
  };

  const changePrefixColor = (e) => {
    setPrefixColor(e.hex);
    setEdited(true);
  };

  const changeStrokeSize = (e) => {
    const newSize = parseFloat(e.target.value) || 0;
    setStroke({ ...stroke, size: newSize, enabled: newSize > 0 });
    setEdited(true);
  };

  const changeStrokeColor = (e) => {
    setStroke({
      ...stroke,
      color: { r: e.rgb.r, g: e.rgb.g, b: e.rgb.b },
      enabled: true,
    });
    setEdited(true);
  };

  const saveStyle = (e) => {
    e.preventDefault();
    if (!name || !textProps) {
      nativeAlert(locale.errorStyleCreation, locale.errorTitle, true);
      return false;
    }
    const fixedStroke = {
      ...stroke,
      enabled: stroke.size > 0 ? true : false,
    };
    const normalizedSizePresets = normalizeStyleSizePresets({ sizePresets, textProps });
    const data = {
      name,
      folder,
      textType,
      textProps,
      sizePresets: normalizedSizePresets,
      autoSizeByPageWidth,
      sizePresetDefaultIndex,
      sizePresetMinWidths,
      prefixes,
      prefixColor,
      stroke: fixedStroke,
    };
    if (currentData.create) {
      data.id = Math.random().toString(36).substr(2, 8);
    } else {
      data.id = currentData.id;
    }
    data.edited = Date.now();
    context.dispatch({ type: "saveStyle", data });
    context.dispatch({ type: "setCurrentStyleId", id: data.id });
    if (currentData.walkthroughReturn) {
      context.dispatch({
        type: "setModal",
        modal: "walkthrough",
        data: {
          ...(currentData.walkthroughState || {}),
          initialStep: 1,
          createdStyleId: data.id,
        },
      });
      return;
    }
    closeModal();
  };

  const deleteStyle = (e) => {
    e.preventDefault();
    if (!currentData.id) return;
    nativeConfirm(locale.confirmDeleteStyle, locale.confirmTitle, (ok) => {
      if (!ok) return;
      context.dispatch({ type: "deleteStyle", id: currentData.id });
      closeModal();
    });
  };

  React.useEffect(() => {
    if (nameInputRef.current) nameInputRef.current.focus();
  }, []);

  return (
    <React.Fragment>
      <div className="app-modal-header hostBrdBotContrast">
        <div className="app-modal-title">{currentData.create ? locale.createStyleTitle : locale.editStyleTitle}</div>
        <button className="topcoat-icon-button--large--quiet" title={locale.close} onClick={close}>
          <FiX size={18} />
        </button>
      </div>
      <div className="app-modal-body">
        <form className="app-modal-body-inner" onSubmit={saveStyle}>
          {currentData.create && <FontScanPromo />}
          <div className="fields">
            <div className="field">
              <div className="field-label">{locale.editStyleNameLabel}</div>
              <div className="field-input">
                <input type="text" ref={nameInputRef} value={name} onChange={changeStyleName} className="topcoat-text-input--large" />
              </div>
            </div>
            <div className="field hostBrdTopContrast">
              <div className="field-label">{locale.editStyleFolderLabel}</div>
              <div className="field-input">
                <select value={folder} onChange={changeStyleFolder} className="topcoat-textarea">
                  <option value="">{locale.noFolderTitle}</option>
                  {folderOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {"".padStart(option.depth * 2, ' ')}{option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field hostBrdTopContrast">
              <div className="field-label">{locale.editStyleTextTypeLabel}</div>
              <div className="field-input">
                <select
                  value={textType}
                  onChange={changeTextType}
                  className="topcoat-textarea"
                  aria-label={locale.editStyleTextTypeLabel}
                >
                  <option value="inherit">{locale.editStyleTextTypeInherit}</option>
                  <option value="paragraph">{locale.editStyleTextTypeParagraph}</option>
                  <option value="point">{locale.editStyleTextTypePoint}</option>
                </select>
              </div>
              <div className="field-descr">{locale.editStyleTextTypeDescr}</div>
            </div>
            <div className="field hostBrdTopContrast">
              <div className="field-label">{locale.editStyleCopyLabel}</div>
              <button type="button" className="style-edit-copy-btn topcoat-button--large" onClick={copyLayerStyle}>
                <FiCopy size={18} /> {locale.editStyleCopyButton}
              </button>
              <div className="field-descr">{locale.editStyleCopyDescr}</div>
              <StyleDetails
                textProps={textProps}
                setTextProps={changeTextProps}
                sizePresets={sizePresets}
                setSizePresets={(presets) => {
                  setSizePresets(presets);
                  setEdited(true);
                }}
                autoSizeByPageWidth={autoSizeByPageWidth}
                setAutoSizeByPageWidth={(value) => {
                  setAutoSizeByPageWidth(value);
                  setEdited(true);
                }}
                sizePresetDefaultIndex={sizePresetDefaultIndex}
                setSizePresetDefaultIndex={(index) => {
                  setSizePresetDefaultIndex(index);
                  setEdited(true);
                }}
                sizePresetMinWidths={sizePresetMinWidths}
                setSizePresetMinWidths={(widths) => {
                  setSizePresetMinWidths(widths);
                  setEdited(true);
                }}
                styleSizeStep={context.state.styleSizeStep}
                middleEast={context.state.middleEast}
              />
            </div>
            <div className="field hostBrdTopContrast">
              <div className="field-label">{locale.editStylePrefixesLabel}</div>
              <div className="field-input">
                <textarea rows={2} value={prefixes} onChange={changePrefixes} className="topcoat-textarea" />
              </div>
              <div className="field-descr">{locale.editStylePrefixesDescr}</div>
            </div>
            <div className="field hostBrdTopContrast">
              <div className="field-label">{locale.editStylePrefixColorLabel}</div>
              <div className="field-input">
                <div className="style-edit-color">
                  {colorPickerOpen && (
                    <React.Fragment>
                      <div className="color-picker-overlay" onClick={() => setColorPickerOpen(false)}></div>
                      <SketchPicker disableAlpha={true} color={prefixColor} onChange={changePrefixColor} presetColors={["#FFA6A4", "#FDD4BB", "#FFF3B0", "#CDFDD3", "#BEDADC", "#C2F2FF", "#C3C9FF", "#F6D5FF"]} />
                    </React.Fragment>
                  )}
                  <div className="style-edit-color-sample m-opacity" title={locale.editStyleColorButton} onClick={() => setColorPickerOpen(true)}>
                    <div style={{ background: prefixColor }}></div>
                    <span>{prefixColor}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="field hostBrdTopContrast">
              <div className="field-label">{locale.editStyleStrokeLabel}</div>
              <div className="field-input">
                <div className="style-edit-stroke">
                  <input
                    type="number"
                    min={0}
                    value={stroke.size}
                    onChange={changeStrokeSize}
                    className="topcoat-text-input--large"
                  />
                  <div className="style-edit-color m-right">
                    {strokePickerOpen && (
                      <React.Fragment>
                        <div className="color-picker-overlay" onClick={() => setStrokePickerOpen(false)}></div>
                        <SketchPicker disableAlpha={true} color={rgbToHex(stroke.color)} onChange={changeStrokeColor} />
                      </React.Fragment>
                    )}
                    <div className="style-edit-color-sample" title={locale.editStyleColorButton} onClick={() => setStrokePickerOpen(true)}>
                      <div style={{ background: rgbToHex(stroke.color) }}></div>
                      <span>{rgbToHex(stroke.color)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="fields style-edit-actions hostBrdTopContrast">
            <button type="submit" className={"style-edit-save " + (edited ? "topcoat-button--large--cta" : "topcoat-button--large")}>
              <MdSave size={18} /> {locale.save}
            </button>
            {currentData.create ? (
              <button type="button" className="topcoat-button--large--quiet" onClick={close}>
                <MdCancel size={18} /> {locale.cancel}
              </button>
            ) : (
              <button type="button" className="topcoat-button--large--quiet" onClick={deleteStyle}>
                <MdDelete size={18} /> {locale.delete}
              </button>
            )}
          </div>
        </form>
      </div>
      {discardConfirmOpen && (
        <UnsavedChangesDialog
          onConfirm={confirmClose}
          onCancel={() => setDiscardConfirmOpen(false)}
        />
      )}
    </React.Fragment>
  );
});


const StyleDetails = React.memo(function StyleDetails(props) {
  const fonts = React.useMemo(() => getUserFonts(), []);
  const textStyle = props.textProps.layerText.textStyleRange[0].textStyle;
  const paragStyle = props.textProps.layerText.paragraphStyleRange[0].paragraphStyle;
  const sizeStep = Number(props.styleSizeStep) > 0 ? Number(props.styleSizeStep) : 1;
  const currentFont = React.useMemo(() => {
    if (!fonts || !fonts.length) {
      return {
        family: "[" + (textStyle.fontName || textStyle.fontPostScriptName || "none") + "]",
        style: "[" + (textStyle.fontStyleName || "none") + "]",
        notFound: true,
      };
    }
    const ps = textStyle.fontPostScriptName || "";
    const fontName = textStyle.fontName || "";
    const fontStyleName = textStyle.fontStyleName || "Regular";

    // 1. Exact match on postScriptName
    let font = fonts.find((f) => f.postScriptName === ps);
    if (font) return font;

    // 2. Case-insensitive match on postScriptName
    const psLower = ps.toLowerCase();
    if (psLower) {
      font = fonts.find((f) => (f.postScriptName || "").toLowerCase() === psLower);
      if (font) return font;
    }

    // 3. Match normalized postScriptName (ignoring hyphens/spaces/underscores)
    const psClean = psLower.replace(/[-_\s]+/g, "");
    if (psClean) {
      font = fonts.find((f) => (f.postScriptName || "").toLowerCase().replace(/[-_\s]+/g, "") === psClean);
      if (font) return font;
    }

    // 4. Match font.family === fontName AND font.style === fontStyleName
    const familyLower = fontName.toLowerCase();
    const styleLower = fontStyleName.toLowerCase();
    if (familyLower) {
      font = fonts.find((f) => (f.family || "").toLowerCase() === familyLower && (f.style || "").toLowerCase() === styleLower);
      if (font) return font;

      // 5. Match font.family === fontName (any style)
      font = fonts.find((f) => (f.family || "").toLowerCase() === familyLower);
      if (font) return font;
    }

    // 6. Match font.name === fontName or font.name === ps
    if (fontName) {
      const nameLower = fontName.toLowerCase();
      font = fonts.find((f) => (f.name || "").toLowerCase() === nameLower);
      if (font) return font;
    }

    return {
      family: "[" + (textStyle.fontName || textStyle.fontPostScriptName || "none") + "]",
      style: "[" + (textStyle.fontStyleName || "none") + "]",
      notFound: true,
    };
  }, [fonts, textStyle.fontPostScriptName, textStyle.fontName, textStyle.fontStyleName]);

  const [family, setFamily] = React.useState(currentFont.family || "");
  const [colorPickerOpen, setColorPickerOpen] = React.useState(false);

  const families = React.useMemo(
    () => Array.from(new Set(fonts.map((font) => font.family))),
    [fonts]
  );
  const familyFonts = React.useMemo(
    () => fonts.filter((font) => font.family === family),
    [family, fonts]
  );
  const unit = props.textProps.typeUnit.substr(0, 3);

  React.useEffect(() => setFamily(currentFont.family), [currentFont.family]);

  const changeFamily = (familyName) => {
    const font = fonts.find((font) => font.family === familyName);
    if (!font) return false;
    setFamily(familyName);
    changeFont(font);
  };

  const changeFontStyle = (style) => {
    const newProps = deepClone(props.textProps);
    const newStyle = newProps.layerText.textStyleRange[0].textStyle;
    newStyle.fontStyleName = style;
    const font = fonts.find((f) => f.family === family && f.style === style);
    if (font) {
      newStyle.fontPostScriptName = font.postScriptName;
      newStyle.fontName = font.name;
    }
    props.setTextProps(newProps);
  };

  const changeFont = (font) => {
    const newProps = deepClone(props.textProps);
    const newStyle = newProps.layerText.textStyleRange[0].textStyle;
    newStyle.fontPostScriptName = font.postScriptName;
    newStyle.fontStyleName = font.style;
    newStyle.fontName = font.name;
    props.setTextProps(newProps);
  };

  const changeProp = (key, val, e) => {
    if (e) e.preventDefault();
    const newProps = deepClone(props.textProps);
    const newStyle = newProps.layerText.textStyleRange[0].textStyle;
    newStyle[key] = val;
    if (key === "size" && newStyle.impliedFontSize != null) newStyle.impliedFontSize = val;
    props.setTextProps(newProps);
  };

  const activeSize = parseStyleSize(textStyle.size);
  const validPresetValues = props.sizePresets
    .map(parseStyleSize)
    .filter((size, index, values) => size !== null && values.indexOf(size) === index)
    .slice(0, MAX_STYLE_SIZE_PRESETS);

  const activateSizePreset = (value) => {
    const size = parseStyleSize(value);
    if (size !== null && size !== activeSize) changeProp("size", size);
  };

  const changeSizePreset = (index, value) => {
    const next = props.sizePresets.concat([]);
    const previousSize = parseStyleSize(next[index]);
    next[index] = value;
    props.setSizePresets(next);
    const size = parseStyleSize(value);
    if (size !== null && previousSize === activeSize) changeProp("size", size);
  };

  const commitPresetStructure = (nextPresets) => {
    const defaultSize = parseStyleSize(props.sizePresets[props.sizePresetDefaultIndex]);
    const nextWidths = nextPresets.map((size) => {
      const oldIndex = props.sizePresets.findIndex((value) => parseStyleSize(value) === size);
      return oldIndex >= 0 ? props.sizePresetMinWidths[oldIndex] ?? null : null;
    });
    let nextDefaultIndex = nextPresets.findIndex((size) => size === defaultSize);
    if (nextDefaultIndex < 0) nextDefaultIndex = 0;
    nextWidths[nextDefaultIndex] = null;
    props.setSizePresets(nextPresets);
    props.setSizePresetDefaultIndex(nextDefaultIndex);
    props.setSizePresetMinWidths(nextWidths);
    if (nextPresets.length < 2) props.setAutoSizeByPageWidth(false);
  };

  const commitSizePresets = () => {
    const normalized = props.sizePresets
      .map(parseStyleSize)
      .filter((size, index, values) => size !== null && values.indexOf(size) === index)
      .slice(0, MAX_STYLE_SIZE_PRESETS);
    const fallback = activeSize || 1;
    const next = normalized.length ? normalized : [fallback];
    commitPresetStructure(next);
    if (!next.includes(activeSize)) changeProp("size", next[0]);
  };

  const addSizePreset = () => {
    if (validPresetValues.length >= MAX_STYLE_SIZE_PRESETS) return;
    let nextSize = validPresetValues.length
      ? Math.max(...validPresetValues) + sizeStep
      : (activeSize || 1);
    while (validPresetValues.includes(nextSize)) nextSize += sizeStep;
    props.setSizePresets(props.sizePresets.concat(parseFloat(nextSize.toFixed(4))));
    props.setSizePresetMinWidths(props.sizePresetMinWidths.concat(null));
  };

  const removeSizePreset = (index, e) => {
    e.stopPropagation();
    if (validPresetValues.length <= 1) return;
    const removedSize = parseStyleSize(props.sizePresets[index]);
    const next = props.sizePresets.filter((_, presetIndex) => presetIndex !== index);
    const nextValid = next.map(parseStyleSize).filter((size) => size !== null);
    commitPresetStructure(nextValid);
    if (removedSize === activeSize && nextValid.length) changeProp("size", nextValid[Math.min(index, nextValid.length - 1)]);
  };

  const changeAutoSizeDefault = (e) => {
    const index = parseInt(e.target.value, 10) || 0;
    const widths = props.sizePresetMinWidths.concat([]);
    while (widths.length < props.sizePresets.length) widths.push(null);
    widths[index] = null;
    props.setSizePresetDefaultIndex(index);
    props.setSizePresetMinWidths(widths);
  };

  const changePresetMinWidth = (index, value) => {
    const widths = props.sizePresetMinWidths.concat([]);
    while (widths.length < props.sizePresets.length) widths.push(null);
    widths[index] = value;
    props.setSizePresetMinWidths(widths);
  };

  const changeParagraph = (key, val, e) => {
    if (e) e.preventDefault();
    const newProps = deepClone(props.textProps);
    const newStyle = newProps.layerText.paragraphStyleRange[0].paragraphStyle;
    newStyle[key] = val;
    props.setTextProps(newProps);
  };

  const changeLeading = (val) => {
    const newProps = deepClone(props.textProps);
    const newStyle = newProps.layerText.textStyleRange[0].textStyle;
    newStyle.autoLeading = !val;
    if (val) newStyle.leading = val;
    else delete newStyle.leading;
    props.setTextProps(newProps);
  };

  const changeAutoleading = (val) => {
    const newProps = deepClone(props.textProps);
    const newStyle = newProps.layerText.paragraphStyleRange[0].paragraphStyle;
    if (val) newStyle.autoLeadingPercentage = val / 100;
    else newStyle.autoLeadingPercentage = 1.2;
    props.setTextProps(newProps);
  };

  const changeColor = (rgb) => {
    const newProps = deepClone(props.textProps);
    const newStyle = newProps.layerText.textStyleRange[0].textStyle;
    newStyle.color = { red: rgb.r, green: rgb.g, blue: rgb.b };
    props.setTextProps(newProps);
  };

  const changeAntiAlias = (antiAlias) => {
    const newProps = deepClone(props.textProps);
    newProps.layerText.antiAlias = antiAlias;
    props.setTextProps(newProps);
  };

  return (
    <div className="style-edit-props">
      <div className="style-edit-props-row">
        <select value={family} onChange={(e) => changeFamily(e.target.value)} className="topcoat-textarea">
          {currentFont.notFound && (
            <option key={currentFont.family} value={currentFont.family}>
              {currentFont.family}
            </option>
          )}
          {families.map((familyName) => (
            <option key={familyName} value={familyName}>
              {familyName}
            </option>
          ))}
        </select>
        <select value={textStyle.fontStyleName} onChange={(e) => changeFontStyle(e.target.value)} className="topcoat-textarea style-edit-font-style">
          {currentFont.notFound && (
            <option key={currentFont.style} value={currentFont.style}>
              {currentFont.style}
            </option>
          )}
          {familyFonts.map((font) => (
            <option key={font.style} value={font.style}>
              {font.style}
            </option>
          ))}
        </select>
      </div>
      <div className="style-edit-size-section">
        <div className="style-edit-size-heading">
          <AiOutlineLineHeight size={22} />
          <div>
            <div className="style-edit-size-title">{locale.editStyleSizePresetsLabel || "Text size presets"}</div>
            <div className="style-edit-size-descr">{locale.editStyleSizePresetsDescr || "Add up to three sizes and click one to make it active."}</div>
          </div>
        </div>
        <div className="style-edit-size-list">
          {props.sizePresets.map((value, index) => {
            const size = parseStyleSize(value);
            const isActive = size !== null && size === activeSize;
            return (
              <div
                key={index}
                className={"style-edit-size-preset" + (isActive ? " m-active" : "")}
                onClick={() => activateSizePreset(value)}
                title={locale.editStyleActivateSizePreset || "Use this size preset"}
              >
                <input
                  type="number"
                  min={1}
                  step={sizeStep}
                  value={value}
                  onChange={(e) => changeSizePreset(index, e.target.value)}
                  onBlur={commitSizePresets}
                  aria-label={`${locale.editStyleFontSize} ${index + 1}`}
                  className="topcoat-text-input--large"
                />
                <span className="style-edit-size-unit">{unit}</span>
                <button
                  type="button"
                  className="style-edit-size-remove"
                  disabled={validPresetValues.length <= 1}
                  onClick={(e) => removeSizePreset(index, e)}
                  title={locale.editStyleRemoveSizePreset || "Remove size preset"}
                >
                  <FiMinus size={12} />
                </button>
              </div>
            );
          })}
          {validPresetValues.length < MAX_STYLE_SIZE_PRESETS && (
            <button type="button" className="style-edit-size-add" onClick={addSizePreset}>
              <FiPlus size={14} /> {locale.editStyleAddSizePreset || "Add size"}
            </button>
          )}
        </div>
        <div className="style-edit-auto-size hostBrdTopContrast">
          <label className={"topcoat-checkbox style-edit-auto-size-toggle" + (validPresetValues.length < 2 ? " m-disabled" : "")}>
            <input
              type="checkbox"
              checked={props.autoSizeByPageWidth}
              disabled={validPresetValues.length < 2}
              onChange={(e) => props.setAutoSizeByPageWidth(e.target.checked)}
            />
            <div className="topcoat-checkbox__checkmark"></div>
            <span>{locale.editStyleAutoSizeLabel || "Choose size from page width"}</span>
          </label>
          <div className="style-edit-auto-size-descr">
            {validPresetValues.length < 2
              ? (locale.editStyleAutoSizeNeedsPresets || "Add at least two size presets to enable this option.")
              : (locale.editStyleAutoSizeDescr || "Use a default size below the first breakpoint, then switch sizes as the page gets wider.")}
          </div>
          {props.autoSizeByPageWidth && validPresetValues.length >= 2 && (
            <div className="style-edit-auto-size-rules">
              <label className="style-edit-auto-size-default">
                <span>{locale.editStyleAutoSizeDefault || "Default size"}</span>
                <select value={props.sizePresetDefaultIndex} onChange={changeAutoSizeDefault} className="topcoat-textarea">
                  {props.sizePresets.map((size, index) => (
                    <option key={index} value={index}>{parseStyleSize(size)}{unit}</option>
                  ))}
                </select>
              </label>
              <div className="style-edit-auto-size-breakpoints">
                {props.sizePresets.map((size, index) => (
                  index === props.sizePresetDefaultIndex ? null : (
                    <label key={index} className="style-edit-auto-size-rule">
                      <strong>{parseStyleSize(size)}{unit}</strong>
                      <span>{locale.editStyleAutoSizeFrom || "From"}</span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        placeholder="1500"
                        value={props.sizePresetMinWidths[index] ?? ""}
                        onChange={(e) => changePresetMinWidth(index, e.target.value)}
                        className="topcoat-text-input--large"
                      />
                      <span>px</span>
                    </label>
                  )
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="style-edit-props-row">
        <div className="style-edit-props-col m-leading">
          <div className="style-edit-props-icon" title={locale.editStyleFontLeading}>
            <AiOutlineColumnHeight size={24} />
          </div>
          <input
            type="number"
            min={0}
            step="0.1"
            placeholder="auto"
            value={textStyle.leading || ""}
            onChange={(e) => changeLeading(parseFloat(e.target.value))}
            className="topcoat-text-input--large"
          />
          <span className="style-edit-props-unit">{unit}</span>
        </div>
      </div>
      {!textStyle.leading && (
        <div className="style-edit-props-row m-autoleading">
          <div className="style-edit-props-label">
            <span>{locale.editStyleAutoleading}:</span>
          </div>
          <input type="number" min={0} placeholder="120" value={paragStyle.autoLeadingPercentage ? parseInt(paragStyle.autoLeadingPercentage * 100) : 120} onChange={(e) => changeAutoleading(Number(e.target.value))} className="topcoat-text-input--large" />
          <span className="style-edit-props-unit">%</span>
        </div>
      )}
      <div className="style-edit-props-row">
        <div className="style-edit-props-col">
          <div className="style-edit-props-icon" title={locale.editStyleAutoKern}>
            <GrMonospace size={24} />
          </div>
          <select value={textStyle.autoKern || "metricsKern"} onChange={(e) => changeProp("autoKern", e.target.value)} className="topcoat-textarea">
            <option value="metricsKern">{locale.editStyleMetricsKern}</option>
            <option value="opticalKern">{locale.editStyleOpticalKern}</option>
            {textStyle.autoKern === "manual" && <option value="manual">{locale.editStyleManualKern}</option>}
          </select>
        </div>
        <div className="style-edit-props-col">
          <div className="style-edit-props-icon" title={locale.editStyleTracking}>
            <TiSortAlphabetically size={24} />
          </div>
          <input type="number" value={textStyle.tracking || 0} onChange={(e) => changeProp("tracking", Number(e.target.value) || 0)} className="topcoat-text-input--large" />
        </div>
      </div>
      <div className="style-edit-props-row">
        <div className="style-edit-props-col">
          <div className="style-edit-props-icon" title={locale.editStyleVerticalScale}>
            <GiVerticalFlip size={24} />
          </div>
          <input type="number" min={0} max={1000} value={Math.round(textStyle.verticalScale || 100)} onChange={(e) => changeProp("verticalScale", Number(e.target.value) || 100)} className="topcoat-text-input--large" />
          <span className="style-edit-props-unit">%</span>
        </div>
        <div className="style-edit-props-col">
          <div className="style-edit-props-icon" title={locale.editStyleHorizontalScale}>
            <GiHorizontalFlip size={24} />
          </div>
          <input type="number" min={0} max={1000} value={Math.round(textStyle.horizontalScale || 100)} onChange={(e) => changeProp("horizontalScale", Number(e.target.value) || 100)} className="topcoat-text-input--large" />
          <span className="style-edit-props-unit">%</span>
        </div>
      </div>
      <div className="style-edit-props-row">
        <div className="style-edit-props-col">
          <div className="style-edit-props-icon" title={locale.editStyleBaselineShift}>
            <AiOutlineToTop size={24} />
          </div>
          <input type="number" value={textStyle.baselineShift || 0} onChange={(e) => changeProp("baselineShift", Number(e.target.value) || 0)} className="topcoat-text-input--large" />
          <span className="style-edit-props-unit">{unit}</span>
        </div>
        <div className="style-edit-props-col">
          <div className="style-edit-props-icon" title={locale.editStyleTextColor}>
            <MdFormatColorText size={24} />
          </div>
          <div className="style-edit-color m-right">
            {colorPickerOpen && (
              <React.Fragment>
                <div className="color-picker-overlay" onClick={() => setColorPickerOpen(false)}></div>
                <SketchPicker disableAlpha={true} color={rgbToHex(textStyle.color)} onChange={(e) => changeColor(e.rgb)} />
              </React.Fragment>
            )}
            <div className="style-edit-color-sample" title={locale.editStyleColorButton} onClick={() => setColorPickerOpen(true)}>
              <div style={{ background: rgbToHex(textStyle.color) }}></div>
              <span>{rgbToHex(textStyle.color)}</span>
            </div>
          </div>
        </div>
      </div>
      {props.middleEast && (
        <div className="style-edit-props-row">
          <div className="style-edit-props-col">
            <div className="style-edit-props-icon double" title={locale.editStyleDiacXOffset}>
              <TbAlphabetArabic size={12} />
              <GiHorizontalFlip size={12} />
            </div>
            <input type="number" value={textStyle.diacXOffset || 0} onChange={(e) => changeProp("diacXOffset", Number(e.target.value) || 0)} className="topcoat-text-input--large" />
            <span className="style-edit-props-unit">{unit}</span>
          </div>
          <div className="style-edit-props-col">
            <div className="style-edit-props-icon double" title={locale.editStyleMarkYOffset}>
              <TbAlphabetArabic size={12} />
              <GiVerticalFlip size={12} />
            </div>
            <input type="number" value={textStyle.markYDistFromBaseline || 100} onChange={(e) => changeProp("markYDistFromBaseline", Number(e.target.value) || 0)} className="topcoat-text-input--large" />
            <span className="style-edit-props-unit">{unit}</span>
          </div>
        </div>
      )}
      <div className="style-edit-props-row">
        <div className="style-edit-props-col">
          <div className="style-edit-props-icon" title={locale.editStyleAntiAlias}>
            <BsType size={24} />
          </div>
          <select value={props.textProps.layerText.antiAlias || "antiAliasNone"} onChange={(e) => changeAntiAlias(e.target.value)} className="topcoat-textarea">
            <option value="antiAliasNone">{locale.editStyleAANone}</option>
            <option value="antiAliasSharp">{locale.editStyleAASharp}</option>
            <option value="antiAliasCrisp">{locale.editStyleAACrisp}</option>
            <option value="antiAliasStrong">{locale.editStyleAAStrong}</option>
            <option value="antiAliasSmooth">{locale.editStyleAASmooth}</option>
            {["antiAliasPlatformLCD", "antiAliasPlatformGray"].includes(props.textProps.layerText.antiAlias) && <option value={props.textProps.layerText.antiAlias}>{locale.editStyleAAOther}</option>}
          </select>
        </div>
        <div className="style-edit-props-col m-justify">
          {textStyle.syntheticBold ? (
            <button className="topcoat-icon-button--large" title={locale.editStyleBold} onClick={(e) => changeProp("syntheticBold", false, e)}>
              <BsTypeBold size={18} />
            </button>
          ) : (
            <button className="topcoat-icon-button--large--quiet" title={locale.editStyleBold} onClick={(e) => changeProp("syntheticBold", true, e)}>
              <BsTypeBold size={18} />
            </button>
          )}
          {textStyle.syntheticItalic ? (
            <button className="topcoat-icon-button--large" title={locale.editStyleItalic} onClick={(e) => changeProp("syntheticItalic", false, e)}>
              <BsTypeItalic size={18} />
            </button>
          ) : (
            <button className="topcoat-icon-button--large--quiet" title={locale.editStyleItalic} onClick={(e) => changeProp("syntheticItalic", true, e)}>
              <BsTypeItalic size={18} />
            </button>
          )}
          {textStyle.fontCaps === "allCaps" ? (
            <button className="topcoat-icon-button--large" title={locale.editStyleCapital} onClick={(e) => changeProp("fontCaps", null, e)}>
              <BsFonts size={18} />
            </button>
          ) : (
            <button className="topcoat-icon-button--large--quiet" title={locale.editStyleCapital} onClick={(e) => changeProp("fontCaps", "allCaps", e)}>
              <BsFonts size={18} />
            </button>
          )}
          {textStyle.fontCaps === "smallCaps" ? (
            <button className="topcoat-icon-button--large" title={locale.editStyleSmall} onClick={(e) => changeProp("fontCaps", null, e)}>
              <AiOutlineFontSize size={18} />
            </button>
          ) : (
            <button className="topcoat-icon-button--large--quiet" title={locale.editStyleSmall} onClick={(e) => changeProp("fontCaps", "smallCaps", e)}>
              <AiOutlineFontSize size={18} />
            </button>
          )}
          {textStyle.ligature ? (
            <button className="topcoat-icon-button--large" title={locale.editStyleLigatures} onClick={(e) => changeProp("ligature", false, e)}>
              <span className="style-edit-ligature-icon">fi</span>
            </button>
          ) : (
            <button className="topcoat-icon-button--large--quiet" title={locale.editStyleLigatures} onClick={(e) => changeProp("ligature", true, e)}>
              <span className="style-edit-ligature-icon">fi</span>
            </button>
          )}
        </div>
      </div>
      <div className="style-edit-props-row">
        <div className="style-edit-props-col m-justify">
          {paragStyle.alignment === "left" ? (
            <button className="topcoat-icon-button--large" title={locale.editStyleAlignLeft} onClick={(e) => changeParagraph("alignment", null, e)}>
              <AiOutlineAlignLeft size={18} />
            </button>
          ) : (
            <button className="topcoat-icon-button--large--quiet" title={locale.editStyleAlignLeft} onClick={(e) => changeParagraph("alignment", "left", e)}>
              <AiOutlineAlignLeft size={18} />
            </button>
          )}
          {paragStyle.alignment === "center" ? (
            <button className="topcoat-icon-button--large" title={locale.editStyleAlignCenter} onClick={(e) => changeParagraph("alignment", null, e)}>
              <AiOutlineAlignCenter size={18} />
            </button>
          ) : (
            <button className="topcoat-icon-button--large--quiet" title={locale.editStyleAlignCenter} onClick={(e) => changeParagraph("alignment", "center", e)}>
              <AiOutlineAlignCenter size={18} />
            </button>
          )}
          {paragStyle.alignment === "right" ? (
            <button className="topcoat-icon-button--large" title={locale.editStyleAlignRight} onClick={(e) => changeParagraph("alignment", null, e)}>
              <AiOutlineAlignRight size={18} />
            </button>
          ) : (
            <button className="topcoat-icon-button--large--quiet" title={locale.editStyleAlignRight} onClick={(e) => changeParagraph("alignment", "right", e)}>
              <AiOutlineAlignRight size={18} />
            </button>
          )}
          {paragStyle.hyphenate ? (
            <button className="topcoat-icon-button--large" title={locale.editStyleHyphen} onClick={(e) => changeParagraph("hyphenate", false, e)}>
              <FiMinus size={18} />
            </button>
          ) : (
            <button className="topcoat-icon-button--large--quiet" title={locale.editStyleHyphen} onClick={(e) => changeParagraph("hyphenate", true, e)}>
              <FiMinus size={18} />
            </button>
          )}
          {paragStyle.hangingRoman ? (
            <button className="topcoat-icon-button--large" title={locale.editStyleHanging} onClick={(e) => changeParagraph("hangingRoman", false, e)}>
              <GrBlockQuote size={18} />
            </button>
          ) : (
            <button className="topcoat-icon-button--large--quiet" title={locale.editStyleHanging} onClick={(e) => changeParagraph("hangingRoman", true, e)}>
              <GrBlockQuote size={18} />
            </button>
          )}
        </div>
        <div className="style-edit-props-col m-justify">
          {textStyle.baseline === "superScript" ? (
            <button className="topcoat-icon-button--large" title={locale.editStyleSuper} onClick={(e) => changeProp("baseline", "normal", e)}>
              <GrSuperscript size={18} />
            </button>
          ) : (
            <button className="topcoat-icon-button--large--quiet" title={locale.editStyleSuper} onClick={(e) => changeProp("baseline", "superScript", e)}>
              <GrSuperscript size={18} />
            </button>
          )}
          {textStyle.baseline === "subScript" ? (
            <button className="topcoat-icon-button--large" title={locale.editStyleSub} onClick={(e) => changeProp("baseline", "normal", e)}>
              <GrSubscript size={18} />
            </button>
          ) : (
            <button className="topcoat-icon-button--large--quiet" title={locale.editStyleSub} onClick={(e) => changeProp("baseline", "subScript", e)}>
              <GrSubscript size={18} />
            </button>
          )}
          {textStyle.underline === "underlineOnLeftInVertical" ? (
            <button className="topcoat-icon-button--large" title={locale.editStyleUnderline} onClick={(e) => changeProp("underline", "underlineOff", e)}>
              <BsTypeUnderline size={18} />
            </button>
          ) : (
            <button className="topcoat-icon-button--large--quiet" title={locale.editStyleUnderline} onClick={(e) => changeProp("underline", "underlineOnLeftInVertical", e)}>
              <BsTypeUnderline size={18} />
            </button>
          )}
          {textStyle.strikethrough === "xHeightStrikethroughOn" ? (
            <button className="topcoat-icon-button--large" title={locale.editStyleStrike} onClick={(e) => changeProp("strikethrough", "strikethroughOff", e)}>
              <BsTypeStrikethrough size={18} />
            </button>
          ) : (
            <button className="topcoat-icon-button--large--quiet" title={locale.editStyleStrike} onClick={(e) => changeProp("strikethrough", "xHeightStrikethroughOn", e)}>
              <BsTypeStrikethrough size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
StyleDetails.propTypes = {
  textProps: PropTypes.object.isRequired,
  setTextProps: PropTypes.func.isRequired,
  sizePresets: PropTypes.array.isRequired,
  setSizePresets: PropTypes.func.isRequired,
  autoSizeByPageWidth: PropTypes.bool.isRequired,
  setAutoSizeByPageWidth: PropTypes.func.isRequired,
  sizePresetDefaultIndex: PropTypes.number.isRequired,
  setSizePresetDefaultIndex: PropTypes.func.isRequired,
  sizePresetMinWidths: PropTypes.array.isRequired,
  setSizePresetMinWidths: PropTypes.func.isRequired,
  styleSizeStep: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  middleEast: PropTypes.bool,
};

export default EditStyleModal;
