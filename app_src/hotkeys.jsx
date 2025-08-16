import _ from "lodash";
import React from "react";

import { csInterface, setActiveLayerText, createTextLayerInSelection, createTextLayersInStoredSelections, alignTextLayerToSelection, getHotkeyPressed, changeActiveLayerTextSize } from "./utils";
import { useContext } from "./context";

const CTRL = "CTRL";
const SHIFT = "SHIFT";
const ALT = "ALT";
const WIN = "WIN";

const intervalTime = 50;
let keyboardInterval = 0;
let keyUp = true;
let lastAction = 0;

const checkRepeatTime = (time = 0) => {
  const now = Date.now();
  if (!keyUp || now - lastAction < time) return false;
  lastAction = now;
  keyUp = false;
  return true;
};

const checkShortcut = (state, ref) => {
  return ref.every((key) => state.includes(key));
};

const HotkeysListner = React.memo(function HotkeysListner() {
  const context = useContext();
  const checkState = (state) => {
    const realState = state.split("a");
    realState.shift();
    realState.pop();
    if (checkShortcut(realState, context.state.shortcut.add)) {
      if (!checkRepeatTime()) return;
      
      const storedSelections = context.state.storedSelections || [];
      
      if (context.state.multiBubbleMode && storedSelections.length > 0) {
        // Mode sélections multiples
        const texts = [];
        const styles = [];
        
        // Déterminer la page de départ
        const getCurrentPageIndex = (lineIndex) => {
          let currentPage = 0;
          for (let i = 0; i <= lineIndex && i < context.state.lines.length; i++) {
            const line = context.state.lines[i];
            if (line.ignore) {
              const page = line.rawText.match(/Page ([0-9]+)/);
              if (page && context.state.images[page[1] - 1]) {
                const img = context.state.images[page[1] - 1];
                currentPage = context.state.images.indexOf(img);
              }
            }
          }
          return currentPage;
        };
        
        const startingPage = getCurrentPageIndex(context.state.currentLineIndex);
        
        // Récupérer les textes à partir de la ligne courante
        let lineIndex = context.state.currentLineIndex;
        for (let i = 0; i < storedSelections.length; i++) {
          let targetLine = null;
          // Trouver la prochaine ligne valide à partir de la ligne courante
          while (lineIndex < context.state.lines.length) {
            const line = context.state.lines[lineIndex];
            
            // Vérifier si on est toujours sur la même page
            const currentPageOfLine = getCurrentPageIndex(lineIndex);
            if (currentPageOfLine !== startingPage) {
              break; // On a changé de page, arrêter
            }
            
            if (line && !line.ignore) {
              targetLine = line;
              lineIndex++; // Avancer à la ligne suivante pour la prochaine itération
              break;
            }
            lineIndex++;
          }
          
          // Arrêter si pas de ligne disponible
          if (!targetLine) {
            break;
          }
          
          if (targetLine) {
            texts.push(targetLine.text);
            
            // Priorité au style de prefix/tag de la ligne
            let lineStyle = null;
            
            if (targetLine.style) {
              // Si la ligne a un prefix de style, utiliser ce style (priorité absolue)
              lineStyle = targetLine.style;
            } else {
              // Sinon, utiliser le style qui était actif au moment de cette sélection
              const selection = storedSelections[i];
              
              if (selection.styleId) {
                // Retrouver le style par son ID
                lineStyle = context.state.styles.find(s => s.id === selection.styleId);
              }
              
              // Si pas de style trouvé, utiliser le style par défaut
              if (!lineStyle) {
                lineStyle = context.state.currentStyle;
              }
            }
            
            // Appliquer le scale si nécessaire
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
            // Pas assez de lignes, on réutilise la dernière ligne et son style
            texts.push(texts[texts.length - 1] || "");
            styles.push(styles[styles.length - 1] || context.state.currentStyle);
          }
        }
        
        const pointText = context.state.pastePointText;
        createTextLayersInStoredSelections(texts, styles, storedSelections, pointText, (ok) => {
          if (ok) {
            // Trouver la prochaine ligne valide après les lignes utilisées, mais rester sur la même page
            let nextLineIndex = lineIndex;
            while (nextLineIndex < context.state.lines.length) {
              const line = context.state.lines[nextLineIndex];
              
              // Vérifier si on est toujours sur la même page
              const currentPageOfNextLine = getCurrentPageIndex(nextLineIndex);
              if (currentPageOfNextLine !== startingPage) {
                // On a changé de page, rester sur la dernière ligne valide de la page courante
                let lastValidLineOnPage = context.state.currentLineIndex;
                for (let i = context.state.currentLineIndex; i < nextLineIndex; i++) {
                  const checkLine = context.state.lines[i];
                  if (checkLine && !checkLine.ignore) {
                    lastValidLineOnPage = i;
                  }
                }
                context.dispatch({ type: "setCurrentLineIndex", index: lastValidLineOnPage });
                break;
              }
              
              if (line && !line.ignore) {
                context.dispatch({ type: "setCurrentLineIndex", index: nextLineIndex });
                break;
              }
              nextLineIndex++;
            }
            // Vider les sélections stockées
            context.dispatch({ type: "clearSelections" });
          }
        });
      } else {
        // Mode sélection unique (comportement original)
        const line = context.state.currentLine || { text: "" };
        let style = context.state.currentStyle;
        if (style && context.state.textScale) {
          style = _.cloneDeep(style);
          const txtStyle = style.textProps?.layerText.textStyleRange?.[0]?.textStyle || {};
          if (typeof txtStyle.size === "number") {
            txtStyle.size *= context.state.textScale / 100;
          }
          if (typeof txtStyle.leading === "number" && txtStyle.leading) {
            txtStyle.leading *= context.state.textScale / 100;
          }
        }
        const pointText = context.state.pastePointText;
        createTextLayerInSelection(line.text, style, pointText, (ok) => {
          if (ok) context.dispatch({ type: "nextLine", add: true });
        });
      }
    } else if (checkShortcut(realState, context.state.shortcut.apply)) {
      if (!checkRepeatTime()) return;
      const line = context.state.currentLine || { text: "" };
      let style = context.state.currentStyle;
      if (style && context.state.textScale) {
        style = _.cloneDeep(style);
        const txtStyle = style.textProps?.layerText.textStyleRange?.[0]?.textStyle || {};
        if (typeof txtStyle.size === "number") {
          txtStyle.size *= context.state.textScale / 100;
        }
        if (typeof txtStyle.leading === "number" && txtStyle.leading) {
          txtStyle.leading *= context.state.textScale / 100;
        }
      }
      setActiveLayerText(line.text, style, (ok) => {
        if (ok) context.dispatch({ type: "nextLine", add: true });
      });
    } else if (checkShortcut(realState, context.state.shortcut.center)) {
      if (!checkRepeatTime()) return;
      alignTextLayerToSelection(context.state.resizeTextBoxOnCenter);
    } else if (checkShortcut(realState, context.state.shortcut.next)) {
      if (!checkRepeatTime(300)) return;
      context.dispatch({ type: "nextLine" });
    } else if (checkShortcut(realState, context.state.shortcut.previous)) {
      if (!checkRepeatTime(300)) return;
      context.dispatch({ type: "prevLine" });
    } else if (checkShortcut(realState, context.state.shortcut.increase)) {
      if (!checkRepeatTime(300)) return;
      changeActiveLayerTextSize(context.state.textSizeIncrement || 1);
    } else if (checkShortcut(realState, context.state.shortcut.decrease)) {
      if (!checkRepeatTime(300)) return;
      changeActiveLayerTextSize(-(context.state.textSizeIncrement || 1));
    } else if (checkShortcut(realState, context.state.shortcut.insertText)) {
      if (!checkRepeatTime()) return;
      const line = context.state.currentLine || { text: "" };
      setActiveLayerText(line.text, null, (ok) => {
        if (ok) context.dispatch({ type: "nextLine", add: true });
      });
    } else if (checkShortcut(realState, context.state.shortcut.nextPage)) {
      if (!checkRepeatTime(300)) return;
      context.dispatch({ type: "nextPage" });
    } else {
      keyUp = true;
    }

  };

  clearInterval(keyboardInterval);
  keyboardInterval = setInterval(() => {
    if (context.state.modalType === "settings") return;
    getHotkeyPressed(checkState);
  }, intervalTime);

  document.onkeydown = (e) => {
    if (e.key === "Escape") {
      if (context.state.modalType) {
        context.dispatch({ type: "setModal" });
      }
    }
  };

  React.useEffect(() => {
    const keyInterests = [{ keyCode: 27 }];
    csInterface.registerKeyEventsInterest(JSON.stringify(keyInterests));
  }, []);

  return <React.Fragment />;
});

export default HotkeysListner;
