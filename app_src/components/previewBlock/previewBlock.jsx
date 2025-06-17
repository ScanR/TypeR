import "./previewBlock.scss";

import _ from "lodash";
import React from "react";
import { FiArrowRightCircle, FiPlusCircle, FiMinusCircle, FiArrowUp, FiArrowDown } from "react-icons/fi";
import { AiOutlineBorderInner } from "react-icons/ai";
import { MdCenterFocusWeak } from "react-icons/md";

import { locale, setActiveLayerText, createTextLayerInSelection, createTextLayerInBounds, getSelectionBoundsList, alignTextLayerToSelection, changeActiveLayerTextSize, getStyleObject, scrollToLine } from "../../utils";
import { useContext } from "../../context";

const PreviewBlock = React.memo(function PreviewBlock() {
  const context = useContext();
  const style = context.state.currentStyle || {};
  const line = context.state.currentLine || { text: "" };
  const textStyle = style.textProps?.layerText.textStyleRange[0].textStyle || {};
  const styleObject = getStyleObject(textStyle);

  const createLayer = () => {
    const pointText = context.state.pastePointText;
    getSelectionBoundsList((data) => {
      let list = [];
      try {
        list = JSON.parse(data || "{}").bounds || [];
      } catch (e) {
        list = [];
      }
      if (list.length <= 1) {
        let lStyle = context.state.currentStyle;
        if (lStyle && context.state.textScale) {
          lStyle = _.cloneDeep(lStyle);
          const ts = lStyle.textProps?.layerText.textStyleRange?.[0]?.textStyle || {};
          if (typeof ts.size === "number") ts.size *= context.state.textScale / 100;
          if (typeof ts.leading === "number" && ts.leading) ts.leading *= context.state.textScale / 100;
        }
        createTextLayerInSelection(line.text, lStyle, pointText, (ok) => {
          if (ok) context.dispatch({ type: "nextLine", add: true });
        });
      } else {
        const makeLayer = (index) => {
          if (index >= list.length) return;
          const l = context.state.currentLine || { text: "" };
          let style = context.state.currentStyle;
          if (style && context.state.textScale) {
            style = _.cloneDeep(style);
            const ts = style.textProps?.layerText.textStyleRange?.[0]?.textStyle || {};
            if (typeof ts.size === "number") ts.size *= context.state.textScale / 100;
            if (typeof ts.leading === "number" && ts.leading) ts.leading *= context.state.textScale / 100;
          }
          createTextLayerInBounds(l.text, style, list[index], pointText, (ok) => {
            if (ok) context.dispatch({ type: "nextLine", add: true });
            makeLayer(index + 1);
          });
        };
        makeLayer(0);
      }
    });
  };

  const insertStyledText = () => {
    let lineStyle = context.state.currentStyle;
    if (lineStyle && context.state.textScale) {
      lineStyle = _.cloneDeep(lineStyle);
      const txtStyle = lineStyle.textProps?.layerText.textStyleRange?.[0]?.textStyle || {};
      if (typeof txtStyle.size === "number") {
        txtStyle.size *= context.state.textScale / 100;
      }
      if (typeof txtStyle.leading === "number" && txtStyle.leading) {
        txtStyle.leading *= context.state.textScale / 100;
      }
    }
    setActiveLayerText(line.text, lineStyle, (ok) => {
      if (ok) context.dispatch({ type: "nextLine", add: true });
    });
  };

  const currentLineClick = () => {
    if (line.rawIndex === void 0) return;
    scrollToLine(line.rawIndex);
  };

  const setTextScale = (scale) => {
    context.dispatch({ type: "setTextScale", scale });
  };
  const focusScale = () => {
    if (!context.state.textScale) setTextScale(100);
  };
  const blurScale = () => {
    if (context.state.textScale === 100) setTextScale(null);
  };

  return (
    <React.Fragment>
      <div className="preview-top">
        <button className="preview-top_big-btn topcoat-button--large--cta" title={locale.createLayerDescr} onClick={createLayer}>
          <AiOutlineBorderInner size={18} /> {locale.createLayer}
        </button>
        <button className="preview-top_big-btn topcoat-button--large" title={locale.alignLayerDescr} onClick={() => alignTextLayerToSelection()}>
          <MdCenterFocusWeak size={18} /> {locale.alignLayer}
        </button>
        <div className="preview-top_change-size-cont">
          <button className="topcoat-icon-button--large" title={locale.layerTextSizeMinus} onClick={() => changeActiveLayerTextSize(-1)}>
            <FiMinusCircle size={18} />
          </button>
          <button className="topcoat-icon-button--large" title={locale.layerTextSizePlus} onClick={() => changeActiveLayerTextSize(1)}>
            <FiPlusCircle size={18} />
          </button>
        </div>
      </div>
      <div className="preview-bottom">
        <div className="preview-nav">
          <button className="topcoat-icon-button--large" title={locale.prevLine} onClick={() => context.dispatch({ type: "prevLine" })}>
            <FiArrowUp size={18} />
          </button>
          <button className="topcoat-icon-button--large" title={locale.nextLine} onClick={() => context.dispatch({ type: "nextLine" })}>
            <FiArrowDown size={18} />
          </button>
        </div>
        <div className="preview-current hostBgdDark" title={locale.scrollToLine} onClick={currentLineClick}>
          <div className="preview-line-info">
            <div className="preview-line-info-text">
              {locale.previewLine}: <b>{line.index || "—"}</b>, {locale.previewStyle}: <b className="preview-line-style-name">{style.name || "—"}</b>, {locale.previewTextScale}:
              <div className="preview-line-scale">
                <input min={1} max={999} type="number" placeholder="100" value={context.state.textScale || ""} onChange={(e) => setTextScale(e.target.value)} onFocus={focusScale} onBlur={blurScale} className="topcoat-text-input" />
                <span>%</span>
              </div>
            </div>
            <div className="preview-line-info-actions" title={locale.insertStyledText}>
              <FiArrowRightCircle size={16} onClick={insertStyledText} />
            </div>
          </div>
          <div className="preview-line-text" style={styleObject} dangerouslySetInnerHTML={{ __html: `<span style='font-family: "${styleObject.fontFamily || "Tahoma"}"'>${line.text || ""}</span>` }}></div>
        </div>
      </div>
    </React.Fragment>
  );
});

export default PreviewBlock;
