import "./footer.scss";

import React from "react";
import { locale } from "../../utils";
import { useContext } from "../../context";
import HiddenFileInput from "../hiddenFileInput/hiddenFileInput";

const AppFooter = React.memo(function AppFooter() {
  const context = useContext((state) => ({
    images: state.images,
    multiBubbleMode: state.multiBubbleMode,
    doubleBubbleMode: state.doubleBubbleMode,
    inlineTextShapeR: state.inlineTextShapeR,
    uiLayout: state.uiLayout,
  }));
  const openSettings = () => {
    context.dispatch({
      type: "setModal",
      modal: "settings",
    });
  };
  const openHelp = () => {
    context.dispatch({
      type: "setModal",
      modal: "help",
    });
  };
  const fileInputRef = React.useRef();

  const openRepository = () => {
    if (context.state.images.length) {
      context.dispatch({ type: "setImages", images: [] });
      return;
    }
    fileInputRef.current?.click();
  };

  const toggleMultiBubble = () => {
    context.dispatch({ type: "setMultiBubbleMode", value: !context.state.multiBubbleMode });
  };

  const toggleInlineTextShapeR = () => {
    context.dispatch({ type: "setInlineTextShapeR", value: !context.state.inlineTextShapeR });
  };
  const toggleDoubleBubble = () => {
    context.dispatch({ type: "setDoubleBubbleMode", value: !context.state.doubleBubbleMode });
  };

  const uiVisible = context.state.uiLayout?.visible || {};

  return (
    <React.Fragment>
      {uiVisible.footerHelp !== false && (
      <span className="link" onClick={openHelp}>
        {locale.footerHelp}
      </span>
      )}
      <span className="link" onClick={openSettings}>
        {locale.footerSettings}
      </span>
      {uiVisible.footerRepo !== false && (
      <span className="link" onClick={openRepository}>
        {context.state.images.length
          ? locale.footerDesyncRepo
          : locale.footerOpenRepo}
      </span>
      )}
      {uiVisible.footerModeToggles !== false && (
      <span className="footer-modes">
      <span
        className="link footer-mode-indicator footer-mode-spacer"
        onClick={toggleInlineTextShapeR}
        title={locale.inlineTextShapeRModeHint || "Shows or hides TextShapeR suggestions directly in the main panel"}
      >
        <span className={`footer-mode-dot ${context.state.inlineTextShapeR ? "is-on" : ""}`} />
        <span className="footer-mode-label">{locale.textShapeRTitle || "TextShapeR"}</span>
        <span className="footer-mode-status">
          {context.state.inlineTextShapeR ? (locale.multiBubbleModeOn || "ON") : (locale.multiBubbleModeOff || "OFF")}
        </span>
      </span>
      <button
        type="button"
        className="link footer-mode-indicator footer-double-bubble"
        onClick={toggleDoubleBubble}
        aria-pressed={context.state.doubleBubbleMode}
        title={locale.doubleBubbleModeHint || "Click inside one half with the magic wand, then Insert. Detects joined bubbles, including thin manga outlines."}
      >
        <span className={`footer-mode-dot ${context.state.doubleBubbleMode ? "is-on" : ""}`} />
        <span className="footer-mode-label">{locale.doubleBubbleModeLabel || "Double bubble"}</span>
        <span className="footer-mode-status">
          {context.state.doubleBubbleMode ? (locale.multiBubbleModeOn || "ON") : (locale.multiBubbleModeOff || "OFF")}
        </span>
      </button>
      <button
        type="button"
        className="link footer-double-bubble"
        disabled={!context.state.doubleBubbleMode}
        onClick={() => context.dispatch({ type: "setModal", modal: "doubleBubbleAssist" })}
        title={locale.bubbleAssistHint || "Correct a joined bubble by marking its two halves"}
      >
        {locale.bubbleAssistButton || "Correct split"}
      </button>
      <span
        className="link footer-mode-indicator footer-mode-adjacent"
        onClick={toggleMultiBubble}
        title={locale.multiBubbleModeHint || "Allows capturing multiple selections to insert multiple texts at once"}
      >
        <span className={`footer-mode-dot ${context.state.multiBubbleMode ? "is-on" : ""}`} />
        <span className="footer-mode-label">Multi-bubble</span>
        <span className="footer-mode-status">
          {context.state.multiBubbleMode ? (locale.multiBubbleModeOn || "ON") : (locale.multiBubbleModeOff || "OFF")}
        </span>
      </span>
      </span>
      )}
      <HiddenFileInput ref={fileInputRef} />
    </React.Fragment>
  );
});

export default AppFooter;
