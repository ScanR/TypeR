import "./previewBlock.scss";

import _ from "lodash";
import React from "react";
import PropTypes from "prop-types";
import { FiArrowRightCircle, FiPlusCircle, FiMinusCircle, FiArrowUp, FiArrowDown, FiAlertTriangle, FiX } from "react-icons/fi";
import { AiOutlineBorderInner } from "react-icons/ai";
import { MdCenterFocusWeak } from "react-icons/md";

import { locale, setActiveLayerText, getCurrentSelection, getSelectionBoundsHash, startSelectionMonitoring, stopSelectionMonitoring, getSelectionChanged, createTextLayerInSelection, createTextLayersInStoredSelections, alignTextLayerToSelection, changeActiveLayerTextSize, getStyleObject, scrollToLine, parseMarkdownRuns } from "../../utils";
import { useContext } from "../../context";

const PreviewBlock = React.memo(function PreviewBlock() {
  const context = useContext();
  const style = context.state.currentStyle || {};
  const line = context.state.currentLine || { text: "" };
  const textStyle = style.textProps?.layerText.textStyleRange[0].textStyle || {};
  const styleObject = getStyleObject(textStyle);
  const markdownEnabled = context.state.interpretMarkdown !== false;
  const renderMarkdownText = React.useCallback((text) => {
    if (!markdownEnabled) return text;
    const parsed = parseMarkdownRuns(text || "");
    if (!parsed.hasFormatting) {
      return parsed.text;
    }
    return parsed.runs.map((run, index) => {
      const runStyle = {};
      if (run.bold) runStyle.fontWeight = "bold";
      if (run.italic) runStyle.fontStyle = "italic";
      return (
        <span key={`md-${index}`} style={runStyle}>
          {run.text}
        </span>
      );
    });
  }, [markdownEnabled]);

  // État pour la détection automatique des sélections
  const [lastSelectionHash, setLastSelectionHash] = React.useState(null);
  const selectionCheckInterval = React.useRef(null);
  const [shiftSelectionWarning, setShiftSelectionWarning] = React.useState(false);
  const shiftTipTimeout = React.useRef(null);
  const [showClearAllTip, setShowClearAllTip] = React.useState(false);
  const clearAllTipTimeout = React.useRef(null);
  const [clearAllTipShown, setClearAllTipShown] = React.useState(false);

  const showShiftTip = React.useCallback(() => {
    setShiftSelectionWarning(true);
    if (shiftTipTimeout.current) {
      clearTimeout(shiftTipTimeout.current);
    }
    shiftTipTimeout.current = setTimeout(() => setShiftSelectionWarning(false), 3500);
  }, []);

  const showClearAllTipFunc = React.useCallback(() => {
    if (clearAllTipShown) return; // Ne montrer qu'une seule fois
    setShowClearAllTip(true);
    setClearAllTipShown(true);
    if (clearAllTipTimeout.current) {
      clearTimeout(clearAllTipTimeout.current);
    }
    clearAllTipTimeout.current = setTimeout(() => setShowClearAllTip(false), 5000);
  }, [clearAllTipShown]);

  const closeClearAllTip = () => {
    setShowClearAllTip(false);
    if (clearAllTipTimeout.current) {
      clearTimeout(clearAllTipTimeout.current);
    }
  };

  const addSelectionAndAdvance = (selection) => {
    if (!selection) return;
    context.dispatch({
      type: "addSelection",
      selection,
      lineIndex: context.state.currentLineIndex,
    });
    if (context.state.multiBubbleMode) {
      context.dispatch({ type: "nextLine", add: true });
    }
  };

  const addCurrentSelection = () => {
    getCurrentSelection((selection) => {
      if (selection) {
        addSelectionAndAdvance(selection);
      }
    });
  };

  const [clearButtonTimeout, setClearButtonTimeout] = React.useState(null);

  const clearStoredSelections = () => {
    const storedSelections = context.state.storedSelections || [];
    if (storedSelections.length === 0) return;
    
    context.dispatch({ type: "removeSelection", index: storedSelections.length - 1 });
  };

  const handleClearMouseDown = () => {
    const timeout = setTimeout(() => {
      context.dispatch({ type: "clearSelections" });
      setClearButtonTimeout(null);
    }, 1000);
    setClearButtonTimeout(timeout);
  };

  const handleClearMouseUp = () => {
    if (clearButtonTimeout) {
      clearTimeout(clearButtonTimeout);
      setClearButtonTimeout(null);
      clearStoredSelections();
    }
  };

  const handleClearMouseLeave = () => {
    if (clearButtonTimeout) {
      clearTimeout(clearButtonTimeout);
      setClearButtonTimeout(null);
    }
  };

  // Fonction pour vérifier les changements de sélection
  const checkForSelectionChange = React.useCallback(() => {
    if (!context.state.multiBubbleMode) return;
    
    getSelectionChanged((selection) => {
      if (selection) {
        if (selection.shiftKey) {
          showShiftTip();
          return;
        }
        const { shiftKey, ...cleanSelection } = selection;
        const newHash = getSelectionBoundsHash(cleanSelection);
        const storedHashes = context.state.storedSelections?.map(s => getSelectionBoundsHash(s)) || [];
        
        // Si la sélection n'est pas déjà stockée, l'ajouter
        if (!storedHashes.includes(newHash)) {
          setLastSelectionHash(newHash);
          addSelectionAndAdvance(cleanSelection);
        }
      }
    });
  }, [context.state.multiBubbleMode, context.state.storedSelections, context.state.currentLineIndex, showShiftTip]);

  // Effect pour démarrer/arrêter la surveillance automatique
  React.useEffect(() => {
    if (context.state.multiBubbleMode) {
      // Démarrer la surveillance Photoshop
      startSelectionMonitoring();
      // Vérifier les changements toutes les 200ms
      selectionCheckInterval.current = setInterval(checkForSelectionChange, 200);
    } else {
      // Arrêter la surveillance
      stopSelectionMonitoring();
      if (selectionCheckInterval.current) {
        clearInterval(selectionCheckInterval.current);
        selectionCheckInterval.current = null;
      }
      setLastSelectionHash(null);
    }

    // Nettoyage lors du démontage
    return () => {
      stopSelectionMonitoring();
      if (selectionCheckInterval.current) {
        clearInterval(selectionCheckInterval.current);
      }
      if (shiftTipTimeout.current) {
        clearTimeout(shiftTipTimeout.current);
      }
      if (clearAllTipTimeout.current) {
        clearTimeout(clearAllTipTimeout.current);
      }
    };
  }, [context.state.multiBubbleMode, checkForSelectionChange]);
  React.useEffect(() => {
    if (!context.state.multiBubbleMode && shiftSelectionWarning) {
      setShiftSelectionWarning(false);
    }
  }, [context.state.multiBubbleMode, shiftSelectionWarning]);

  // Afficher le tip "hold to clear all" quand on dépasse 10 sélections
  React.useEffect(() => {
    const storedSelections = context.state.storedSelections || [];
    if (context.state.multiBubbleMode && storedSelections.length > 10 && !clearAllTipShown) {
      showClearAllTipFunc();
    }
    // Réinitialiser le flag quand on quitte le mode multi-bubble ou qu'on vide les sélections
    if (!context.state.multiBubbleMode || storedSelections.length === 0) {
      setClearAllTipShown(false);
      setShowClearAllTip(false);
    }
  }, [context.state.multiBubbleMode, context.state.storedSelections, clearAllTipShown, showClearAllTipFunc]);

  const createLayer = () => {
    const storedSelections = context.state.storedSelections || [];
    
    if (context.state.multiBubbleMode && storedSelections.length > 0) {
      // Mode sélections multiples
      const texts = [];
      const styles = [];
      const lines = context.state.lines || [];
      let nextFallbackIndex = context.state.currentLineIndex;

      const resolveStyleForLine = (targetLine, selection) => {
        if (targetLine?.style) {
          return targetLine.style;
        }
        if (selection?.styleId) {
          const storedStyle = context.state.styles.find((s) => s.id === selection.styleId);
          if (storedStyle) return storedStyle;
        }
        return context.state.currentStyle;
      };

      const resolveLineForSelection = (selection) => {
        if (typeof selection.lineIndex === "number" && selection.lineIndex >= 0) {
          const storedLine = lines[selection.lineIndex];
          if (storedLine && !storedLine.ignore) {
            nextFallbackIndex = Math.max(nextFallbackIndex, selection.lineIndex + 1);
            return storedLine;
          }
        }

        while (nextFallbackIndex < lines.length) {
          const candidate = lines[nextFallbackIndex];
          nextFallbackIndex++;
          if (candidate && !candidate.ignore) {
            return candidate;
          }
        }
        return null;
      };

      for (let i = 0; i < storedSelections.length; i++) {
        const selection = storedSelections[i];
        const targetLine = resolveLineForSelection(selection);
        if (!targetLine) {
          break;
        }

        texts.push(targetLine.text);

        let lineStyle = resolveStyleForLine(targetLine, selection);
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
        styles.push(lineStyle);
      }
      
      const pointText = context.state.pastePointText;
      const padding = context.state.internalPadding || 0;
      const direction = context.state.direction;
      createTextLayersInStoredSelections(texts, styles, storedSelections, pointText, padding, direction, (ok) => {
        if (ok) {
          // Vider les sélections stockées
          context.dispatch({ type: "clearSelections" });
        }
      });
    } else {
      // Mode sélection unique (comportement original)
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
      const pointText = context.state.pastePointText;
      const padding = context.state.internalPadding || 0;
      const direction = context.state.direction;
      createTextLayerInSelection(line.text, lineStyle, pointText, padding, direction, (ok) => {
        if (ok) context.dispatch({ type: "nextLine", add: true });
      });
    }
  };

  const insertStyledText = () => {
    const storedSelections = context.state.storedSelections || [];
    
    if (context.state.multiBubbleMode && storedSelections.length > 0) {
      // En mode multi-bubble, utiliser la même logique que createLayer
      createLayer();
    } else {
      // Mode normal
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
      setActiveLayerText(line.text, lineStyle, context.state.direction, (ok) => {
        if (ok) context.dispatch({ type: "nextLine", add: true });
      });
    }
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

  const setTextSizeIncrement = (increment) => {
    context.dispatch({ type: "setTextSizeIncrement", increment });
  };
  const handleIncrementChange = (e) => {
    setTextSizeIncrement(e.target.value);
  };
  const handleIncrementBlur = () => {
    if (!context.state.textSizeIncrement || context.state.textSizeIncrement < 1) {
      setTextSizeIncrement(1);
    }
  };

  return (
    <React.Fragment>
      <div className="preview-top">
        {context.state.multiBubbleMode && context.state.storedSelections && context.state.storedSelections.length > 0 && (
          <div className="preview-top_selection-controls">
            <div className="preview-top_selection-info">
              <span className="preview-top_selection-count">{context.state.storedSelections.length} {context.state.storedSelections.length > 1 ? (locale.selectionsCount || 'selections') : (locale.selectionCount || 'selection')}</span>
              <button 
                className="topcoat-icon-button--large" 
                title={locale.clearSelections || "Clear selections"} 
                onMouseDown={handleClearMouseDown}
                onMouseUp={handleClearMouseUp}
                onMouseLeave={handleClearMouseLeave}
              >
                <FiMinusCircle size={16} />
              </button>
            </div>
          </div>
        )}
        {context.state.multiBubbleMode && context.state.showTips !== false && shiftSelectionWarning && (
          <div className="preview-top_selection-warning">
            <FiAlertTriangle size={14} />
            <span>{locale.multiBubbleShiftTip || "Le mode multi-bubble fonctionne avec une sélection à la fois. Relâchez Shift et faites vos sélections une par une."}</span>
          </div>
        )}
        {context.state.multiBubbleMode && context.state.showTips !== false && showClearAllTip && (
          <div className="preview-top_selection-tip">
            <FiMinusCircle size={14} />
            <span>{locale.multiBubbleClearAllTip || "Tip: Hold the - button for 1 second to clear all selections at once"}</span>
            <button 
              className="preview-top_selection-tip-close" 
              onClick={closeClearAllTip}
              title={locale.close || "Close"}
            >
              <FiX size={14} />
            </button>
          </div>
        )}
        <div className="preview-top_main-controls">
          <button className="preview-top_big-btn preview-top_big-btn--small topcoat-button--large--cta" title={
            context.state.multiBubbleMode && context.state.storedSelections && context.state.storedSelections.length > 0 
              ? `Insérer ${context.state.storedSelections.length} texte${context.state.storedSelections.length > 1 ? 's' : ''}` 
              : locale.createLayerDescr
          } onClick={createLayer}>
            <AiOutlineBorderInner size={18} /> {locale.createLayer}
          </button>
          <button className="preview-top_big-btn preview-top_big-btn--small topcoat-button--large" title={locale.alignLayerDescr} onClick={() => {
            const padding = context.state.internalPadding || 0;
            alignTextLayerToSelection(context.state.resizeTextBoxOnCenter, padding);
          }}>
            <MdCenterFocusWeak size={18} /> {locale.alignLayer}
          </button>
          <div className="preview-top_change-size-cont">
            <button className="topcoat-icon-button--large" title={locale.layerTextSizeMinus} onClick={() => changeActiveLayerTextSize(-(context.state.textSizeIncrement || 1))}>
              <FiMinusCircle size={18} />
            </button>
            <div className="preview-top_size-input">
              <input min={1} max={99} type="number" value={context.state.textSizeIncrement || ""} onChange={handleIncrementChange} onBlur={handleIncrementBlur} className="topcoat-text-input" />
              <span>px</span>
            </div>
            <button className="topcoat-icon-button--large" title={locale.layerTextSizePlus} onClick={() => changeActiveLayerTextSize(context.state.textSizeIncrement || 1)}>
              <FiPlusCircle size={18} />
            </button>
          </div>
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
          <div className="preview-line-text" style={styleObject}>
            <span style={{ fontFamily: styleObject.fontFamily || "Tahoma" }}>
              {renderMarkdownText(line.text || "")}
            </span>
          </div>
        </div>
      </div>
    </React.Fragment>
  );
});

export default PreviewBlock;
