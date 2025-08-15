import "./previewBlock.scss";

import _ from "lodash";
import React from "react";
import { FiArrowRightCircle, FiPlusCircle, FiMinusCircle, FiArrowUp, FiArrowDown } from "react-icons/fi";
import { AiOutlineBorderInner } from "react-icons/ai";
import { MdCenterFocusWeak } from "react-icons/md";

import { locale, setActiveLayerText, getCurrentSelection, getSelectionBoundsHash, startSelectionMonitoring, stopSelectionMonitoring, getSelectionChanged, createTextLayerInSelection, createTextLayersInStoredSelections, alignTextLayerToSelection, changeActiveLayerTextSize, getStyleObject, scrollToLine } from "../../utils";
import { useContext } from "../../context";

const PreviewBlock = React.memo(function PreviewBlock() {
  const context = useContext();
  const style = context.state.currentStyle || {};
  const line = context.state.currentLine || { text: "" };
  const textStyle = style.textProps?.layerText.textStyleRange[0].textStyle || {};
  const styleObject = getStyleObject(textStyle);

  // État pour la détection automatique des sélections
  const [lastSelectionHash, setLastSelectionHash] = React.useState(null);
  const selectionCheckInterval = React.useRef(null);

  const addCurrentSelection = () => {
    getCurrentSelection((selection) => {
      if (selection) {
        context.dispatch({ type: "addSelection", selection });
      }
    });
  };

  const clearStoredSelections = () => {
    context.dispatch({ type: "clearSelections" });
  };

  // Fonction pour vérifier les changements de sélection
  const checkForSelectionChange = React.useCallback(() => {
    if (!context.state.multiBubbleMode) return;
    
    getSelectionChanged((selection) => {
      if (selection) {
        const newHash = getSelectionBoundsHash(selection);
        const storedHashes = context.state.storedSelections?.map(s => getSelectionBoundsHash(s)) || [];
        
        // Si la sélection n'est pas déjà stockée, l'ajouter
        if (!storedHashes.includes(newHash)) {
          setLastSelectionHash(newHash);
          context.dispatch({ type: "addSelection", selection });
        }
      }
    });
  }, [context.state.multiBubbleMode, context.state.storedSelections]);

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
    };
  }, [context.state.multiBubbleMode, checkForSelectionChange]);

  const createLayer = () => {
    const storedSelections = context.state.storedSelections || [];
    
    if (context.state.multiBubbleMode && storedSelections.length > 0) {
      // Mode sélections multiples
      const texts = [];
      const styles = [];
      
      // Récupérer les textes à partir de la ligne courante
      let lineIndex = context.state.currentLineIndex;
      for (let i = 0; i < storedSelections.length; i++) {
        let targetLine = null;
        // Trouver la prochaine ligne valide à partir de la ligne courante
        while (lineIndex < context.state.lines.length) {
          const line = context.state.lines[lineIndex];
          if (line && !line.ignore) {
            targetLine = line;
            lineIndex++; // Avancer à la ligne suivante pour la prochaine itération
            break;
          }
          lineIndex++;
        }
        
        if (targetLine) {
          texts.push(targetLine.text);
          
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
          styles.push(lineStyle);
        } else {
          // Pas assez de lignes, on réutilise la dernière ligne
          texts.push(texts[texts.length - 1] || "");
          styles.push(styles[styles.length - 1] || context.state.currentStyle);
        }
      }
      
      const pointText = context.state.pastePointText;
      createTextLayersInStoredSelections(texts, styles, storedSelections, pointText, (ok) => {
        if (ok) {
          // Avancer le curseur au bon endroit (à la dernière ligne utilisée)
          const finalLineIndex = lineIndex - 1;
          if (finalLineIndex >= 0 && finalLineIndex < context.state.lines.length) {
            context.dispatch({ type: "setCurrentLineIndex", index: finalLineIndex });
          }
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
      createTextLayerInSelection(line.text, lineStyle, pointText, (ok) => {
        if (ok) context.dispatch({ type: "nextLine", add: true });
      });
    }
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
              <span className="preview-top_selection-count">{context.state.storedSelections.length} sélection{context.state.storedSelections.length > 1 ? 's' : ''}</span>
              <button className="topcoat-icon-button--large" title="Vider les sélections" onClick={clearStoredSelections}>
                <FiMinusCircle size={16} />
              </button>
            </div>
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
          <button className="preview-top_big-btn preview-top_big-btn--small topcoat-button--large" title={locale.alignLayerDescr} onClick={() => alignTextLayerToSelection(context.state.resizeTextBoxOnCenter)}>
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
          <div className="preview-line-text" style={styleObject} dangerouslySetInnerHTML={{ __html: `<span style='font-family: "${styleObject.fontFamily || "Tahoma"}"'>${line.text || ""}</span>` }}></div>
        </div>
      </div>
    </React.Fragment>
  );
});

export default PreviewBlock;
