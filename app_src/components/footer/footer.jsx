import "./footer.scss";

import React from "react";
import { locale } from "../../utils";
import { useContext } from "../../context";
import HiddenFileInput from "../hiddenFileInput/hiddenFileInput";
import { nextAutoCenterMode } from "../../shortcutCommands";

const AppFooter = React.memo(function AppFooter() {
  const context = useContext((state) => ({
    images: state.images,
    multiBubbleMode: state.multiBubbleMode,
    inlineTextShapeR: state.inlineTextShapeR,
    autoCenterMode: state.autoCenterMode,
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

  // Off -> centre -> multi centre -> off, one click per step
  const cycleAutoCenter = () => {
    context.dispatch({ type: "setAutoCenterMode", value: nextAutoCenterMode(context.state.autoCenterMode) });
  };
  const autoCenterMode = context.state.autoCenterMode || "off";
  const autoCenterStatus = autoCenterMode === "multi"
    ? (locale.autoCenterModeMulti || "MULTI")
    : autoCenterMode === "single"
      ? (locale.multiBubbleModeOn || "ON")
      : (locale.multiBubbleModeOff || "OFF");

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
      <React.Fragment>
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
      <span
        className="link footer-mode-indicator footer-mode-adjacent"
        onClick={cycleAutoCenter}
        title={locale.autoCenterModeHint || "Centers each text in its bubble after the paste. Click to switch: off, center, multi center (double bubbles)."}
      >
        <span className={`footer-mode-dot ${autoCenterMode !== "off" ? "is-on" : ""} ${autoCenterMode === "multi" ? "is-multi" : ""}`} />
        <span className="footer-mode-label">{locale.autoCenterModeLabel || "Auto-center"}</span>
        <span className="footer-mode-status">{autoCenterStatus}</span>
      </span>
      </React.Fragment>
      )}
      <HiddenFileInput ref={fileInputRef} />
    </React.Fragment>
  );
});

export default AppFooter;
