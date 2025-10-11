import "./editStyle.scss";

import _ from "lodash";
import React from "react";
import PropTypes from "prop-types";
import { FiCopy, FiX, FiMinus } from "react-icons/fi";
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

const buildFolderTree = (folders) => {
  const map = new Map();
  (folders || []).forEach((folder) => {
    map.set(folder.id, { ...folder, children: [] });
  });
  const roots = [];
  map.forEach((folder) => {
    if (folder.parentId && map.has(folder.parentId)) {
      map.get(folder.parentId).children.push(folder);
    } else {
      roots.push(folder);
    }
  });
  const sortRecursive = (nodes) => {
    nodes.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    nodes.forEach((node) => sortRecursive(node.children));
  };
  sortRecursive(roots);
  return roots;
};

const flattenFolderTree = (nodes, parents = [], depth = 0) => {
  const list = [];
  nodes.forEach((node) => {
    const breadcrumb = parents.concat(node.name);
    list.push({
      id: node.id,
      depth,
      label: breadcrumb.join(' / '),
    });
    list.push(...flattenFolderTree(node.children || [], breadcrumb, depth + 1));
  });
  return list;
};

const EditStyleModal = React.memo(function EditStyleModal() {
  const context = useContext();
  const currentData = context.state.modalData;
  const [name, setName] = React.useState(currentData.name || "");
  const [folder, setFolder] = React.useState(currentData.folder || "");
  const [textProps, setTextProps] = React.useState(currentData.textProps || getDefaultStyle());
  const [prefixes, setPrefixes] = React.useState(currentData.prefixes?.join("\n") || "");
  const [prefixColor, setPrefixColor] = React.useState(currentData.prefixColor || config.defaultPrefixColor);
  const [colorPickerOpen, setColorPickerOpen] = React.useState(false);
  const [stroke, setStroke] = React.useState(currentData.stroke || getDefaultStroke());
  const [strokePickerOpen, setStrokePickerOpen] = React.useState(false);
  const [edited, setEdited] = React.useState(false);
  const nameInputRef = React.useRef();
  const folderTree = React.useMemo(() => buildFolderTree(context.state.folders), [context.state.folders]);
  const folderOptions = React.useMemo(() => flattenFolderTree(folderTree), [folderTree]);

  const close = () => {
    context.dispatch({ type: "setModal" });
  };

  const changeStyleName = (e) => {
    setName(e.target.value);
    setEdited(true);
  };

  const changeStyleFolder = (e) => {
    setFolder(e.target.value);
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
      if (data.stroke) setStroke(data.stroke);
      setEdited(true);
    });
  };

  const changeTextProps = (newProps) => {
    setTextProps(newProps);
    setEdited(true);
  };

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
    const data = { name, folder, textProps, prefixes, prefixColor, stroke: fixedStroke };
    if (currentData.create) {
      data.id = Math.random().toString(36).substr(2, 8);
    } else {
      data.id = currentData.id;
    }
    data.edited = Date.now();
    context.dispatch({ type: "saveStyle", data });
    close();
  };

  const deleteStyle = (e) => {
    e.preventDefault();
    if (!currentData.id) return;
    nativeConfirm(locale.confirmDeleteStyle, locale.confirmTitle, (ok) => {
      if (!ok) return;
      context.dispatch({ type: "deleteStyle", id: currentData.id });
      close();
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
              <div className="field-label">{locale.editStyleCopyLabel}</div>
              <button type="button" className="style-edit-copy-btn topcoat-button--large" onClick={copyLayerStyle}>
                <FiCopy size={18} /> {locale.editStyleCopyButton}
              </button>
              <div className="field-descr">{locale.editStyleCopyDescr}</div>
              <StyleDetails textProps={textProps} setTextProps={changeTextProps} />
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
    </React.Fragment>
  );
});

const StyleDetails = React.memo(function StyleDetails(props) {
  const context = useContext();
  const fonts = getUserFonts();
  const textStyle = props.textProps.layerText.textStyleRange[0].textStyle;
  const paragStyle = props.textProps.layerText.paragraphStyleRange[0].paragraphStyle;
  const currentFont = fonts.find((font) => font.postScriptName === textStyle.fontPostScriptName) || {
    family: "[" + (textStyle.fontName || "none") + "]",
    style: "[" + (textStyle.fontStyleName || "none") + "]",
    notFound: true,
  };

  const [family, setFamily] = React.useState(currentFont.family || "");
  const [colorPickerOpen, setColorPickerOpen] = React.useState(false);

  const families = fonts.reduce((fams, font) => (fams.includes(font.family) ? fams : fams.concat(font.family)), []);
  const familyFonts = fonts.filter((font) => font.family === family);
  const unit = props.textProps.typeUnit.substr(0, 3);

  React.useEffect(() => setFamily(currentFont.family), [currentFont.family]);

  const changeFamily = (familyName) => {
    const font = fonts.find((font) => font.family === familyName);
    if (!font) return false;
    setFamily(familyName);
    changeFont(font);
  };

  const changeFontStyle = (style) => {
    const newProps = _.cloneDeep(props.textProps);
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
    const newProps = _.cloneDeep(props.textProps);
    const newStyle = newProps.layerText.textStyleRange[0].textStyle;
    newStyle.fontPostScriptName = font.postScriptName;
    newStyle.fontStyleName = font.style;
    newStyle.fontName = font.name;
    props.setTextProps(newProps);
  };

  const changeProp = (key, val, e) => {
    if (e) e.preventDefault();
    const newProps = _.cloneDeep(props.textProps);
    const newStyle = newProps.layerText.textStyleRange[0].textStyle;
    newStyle[key] = val;
    props.setTextProps(newProps);
  };

  const changeParagraph = (key, val, e) => {
    if (e) e.preventDefault();
    const newProps = _.cloneDeep(props.textProps);
    const newStyle = newProps.layerText.paragraphStyleRange[0].paragraphStyle;
    newStyle[key] = val;
    props.setTextProps(newProps);
  };

  const changeLeading = (val) => {
    const newProps = _.cloneDeep(props.textProps);
    const newStyle = newProps.layerText.textStyleRange[0].textStyle;
    newStyle.autoLeading = !val;
    if (val) newStyle.leading = val;
    else delete newStyle.leading;
    props.setTextProps(newProps);
  };

  const changeAutoleading = (val) => {
    const newProps = _.cloneDeep(props.textProps);
    const newStyle = newProps.layerText.paragraphStyleRange[0].paragraphStyle;
    if (val) newStyle.autoLeadingPercentage = val / 100;
    else newStyle.autoLeadingPercentage = 1.2;
    props.setTextProps(newProps);
  };

  const changeColor = (rgb) => {
    const newProps = _.cloneDeep(props.textProps);
    const newStyle = newProps.layerText.textStyleRange[0].textStyle;
    newStyle.color = { red: rgb.r, green: rgb.g, blue: rgb.b };
    props.setTextProps(newProps);
  };

  const changeAntiAlias = (antiAlias) => {
    const newProps = _.cloneDeep(props.textProps);
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
      <div className="style-edit-props-row">
        <div className="style-edit-props-col">
          <div className="style-edit-props-icon" title={locale.editStyleFontSize}>
            <AiOutlineLineHeight size={24} />
          </div>
          <input
            type="number"
            min={1}
            step="0.1"
            value={textStyle.size || ""}
            onChange={(e) => changeProp("size", parseFloat(e.target.value) || null)}
            className="topcoat-text-input--large"
          />
          <span className="style-edit-props-unit">{unit}</span>
        </div>
        <div className="style-edit-props-col">
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
      {context.state.middleEast && (
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
};

export default EditStyleModal;
