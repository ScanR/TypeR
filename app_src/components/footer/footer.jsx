import "./footer.scss";

import React from "react";
import { FiFolderMinus, FiFolderPlus, FiHelpCircle, FiSettings } from "react-icons/fi";
import { MdAdsClick, MdCleaningServices, MdFilterNone, MdOutlineAutoAwesome } from "react-icons/md";
import { locale } from "../../utils";
import { useContext } from "../../context";
import HiddenFileInput from "../hiddenFileInput/hiddenFileInput";
import Notice from "../notice/notice";
import FeatureTip from "../featureTip";
import { isFooterModeVisible } from "../../uiLayout";

// Shared with Settings > Appearance, which lists the toggles one by one
export const FOOTER_MODE_ICONS = {
  textShapeR: MdOutlineAutoAwesome,
  multiBubble: MdFilterNone,
  pasteOnClick: MdAdsClick,
  autoClean: MdCleaningServices,
};
export const footerModeLabel = (id) => ({
  textShapeR: locale.textShapeRTitle || "TextShapeR",
  multiBubble: "Multi-bubble",
  pasteOnClick: locale.footerPasteOnClick || "Click paste",
  autoClean: locale.footerAutoClean || "Auto clean",
})[id];

// One mode toggle: the dot shows the state, the label names the mode. In a
// narrow panel an icon replaces the label. The tooltip always spells out the
// state, so the hint text is never read as one.
const ModeToggle = ({ mode, compact }) => {
  const { on, label, hint, Icon, onClick } = mode;
  const state = on ? (locale.multiBubbleModeOn || "ON") : (locale.multiBubbleModeOff || "OFF");
  return (
    <button
      type="button"
      className="footer-mode"
      data-tour={"mode-" + mode.id}
      aria-pressed={!!on}
      aria-label={label}
      title={label + " (" + state + ") – " + hint}
      onClick={onClick}
    >
      <span className={"footer-mode-dot" + (on ? " is-on" : "")} />
      {compact ? <Icon size={13} className="footer-mode-icon" /> : <span className="footer-mode-label">{label}</span>}
    </button>
  );
};

// The labelled toggles, laid out on one line out of sight: their width
// decides whether the labels fit next to the actions
const ModeMeasure = React.forwardRef(function ModeMeasure({ modes }, ref) {
  return (
    <div className="footer-modes footer-modes-measure" ref={ref} aria-hidden="true">
      {modes.map((mode) => (
        <span key={mode.id} className="footer-mode">
          <span className="footer-mode-dot" />
          <span className="footer-mode-label">{mode.label}</span>
        </span>
      ))}
    </div>
  );
});

const px = (value) => parseFloat(value) || 0;

// Labels when they fit on one line, icons otherwise (any language)
const useCompactModes = (actionsRef, modesRef, measureRef) => {
  const [compact, setCompact] = React.useState(false);
  const update = React.useCallback(() => {
    const actions = actionsRef.current;
    const modes = modesRef.current;
    const measure = measureRef.current;
    if (!actions || !modes || !measure || !actions.parentNode) return;
    const block = actions.parentNode;
    const blockStyle = window.getComputedStyle(block);
    const modesStyle = window.getComputedStyle(modes);
    const available = block.clientWidth - px(blockStyle.paddingLeft) - px(blockStyle.paddingRight) -
      actions.offsetWidth - px(blockStyle.columnGap) - px(modesStyle.paddingLeft) - px(modesStyle.borderLeftWidth);
    const first = measure.firstElementChild;
    const last = measure.lastElementChild;
    const needed = first && last ? last.offsetLeft + last.offsetWidth - first.offsetLeft : 0;
    setCompact(needed > available);
  }, [actionsRef, modesRef, measureRef]);
  // Toggles, labels or the language changed
  React.useLayoutEffect(update);
  React.useEffect(() => {
    window.addEventListener("resize", update);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(update);
    return () => window.removeEventListener("resize", update);
  }, [update]);
  return compact;
};

const AppFooter = React.memo(function AppFooter() {
  const context = useContext((state) => ({
    images: state.images,
    multiBubbleMode: state.multiBubbleMode,
    inlineTextShapeR: state.inlineTextShapeR,
    smartPaste: state.smartPaste,
    pasteOnClick: state.pasteOnClick,
    smartPasteAutoClean: state.smartPasteAutoClean,
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
  const actionsRef = React.useRef();
  const modesRef = React.useRef();
  const measureRef = React.useRef();
  const compact = useCompactModes(actionsRef, modesRef, measureRef);

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

  const togglePasteOnClick = () => {
    context.dispatch({ type: "setPasteOnClick", value: !context.state.pasteOnClick });
  };

  const toggleAutoClean = () => {
    context.dispatch({ type: "setSmartPasteAutoClean", value: !context.state.smartPasteAutoClean });
  };

  const synced = context.state.images.length > 0;
  const repoLabel = synced ? locale.footerDesyncRepo : locale.footerOpenRepo;

  const uiVisible = context.state.uiLayout?.visible || {};

  const allModes = [
    {
      id: "textShapeR",
      on: context.state.inlineTextShapeR,
      label: footerModeLabel("textShapeR"),
      hint: locale.inlineTextShapeRModeHint || "Shows or hides TextShapeR suggestions directly in the main panel",
      Icon: FOOTER_MODE_ICONS.textShapeR,
      onClick: toggleInlineTextShapeR,
    },
    {
      id: "multiBubble",
      on: context.state.multiBubbleMode,
      label: footerModeLabel("multiBubble"),
      hint: locale.multiBubbleModeHint || "Allows capturing multiple selections to insert multiple texts at once",
      Icon: FOOTER_MODE_ICONS.multiBubble,
      onClick: toggleMultiBubble,
    },
    {
      id: "pasteOnClick",
      on: context.state.pasteOnClick,
      label: footerModeLabel("pasteOnClick"),
      hint: locale.footerPasteOnClickTitle || "A Magic Wand click or a rectangle/lasso selection pastes the current line right away.",
      Icon: FOOTER_MODE_ICONS.pasteOnClick,
      onClick: togglePasteOnClick,
    },
  ];
  // Auto clean belongs to smart paste: hidden while smart paste is off
  if (context.state.smartPaste !== false) {
    allModes.push({
      id: "autoClean",
      on: context.state.smartPasteAutoClean,
      label: footerModeLabel("autoClean"),
      hint: locale.footerAutoCleanTitle || "Smart paste paints a white or black fill under the text to cover the original lettering.",
      Icon: FOOTER_MODE_ICONS.autoClean,
      onClick: toggleAutoClean,
    });
  }
  // Settings > Appearance hides toggles one by one; a hidden mode keeps its state
  const modes = allModes.filter((mode) => isFooterModeVisible(context.state.uiLayout, mode.id));

  return (
    <React.Fragment>
      {/* Panel actions: icons, so the mode toggles keep the room */}
      <div className="footer-actions" ref={actionsRef}>
        {uiVisible.footerHelp !== false && (
        <button type="button" className="footer-icon-button" title={locale.footerHelp} aria-label={locale.footerHelp} onClick={openHelp}>
          <FiHelpCircle size={14} />
        </button>
        )}
        <button type="button" className="footer-icon-button" data-tour="settings" title={locale.footerSettings} aria-label={locale.footerSettings} onClick={openSettings}>
          <FiSettings size={14} />
        </button>
        {uiVisible.footerRepo !== false && (
        <button
          type="button"
          className={"footer-icon-button" + (synced ? " is-active" : "")}
          title={repoLabel}
          aria-label={repoLabel}
          onClick={openRepository}
        >
          {synced ? <FiFolderMinus size={14} /> : <FiFolderPlus size={14} />}
        </button>
        )}
      </div>
      {/* Mode toggles: never cut off, they wrap only below the icon width */}
      {modes.length > 0 && (
      <React.Fragment>
        <div className={"footer-modes" + (compact ? " is-compact" : "")} ref={modesRef}>
          {modes.map((mode) => <ModeToggle key={mode.id} mode={mode} compact={compact} />)}
        </div>
        <ModeMeasure ref={measureRef} modes={modes} />
      </React.Fragment>
      )}
      <HiddenFileInput ref={fileInputRef} />
      <Notice />
      <FeatureTip />
    </React.Fragment>
  );
});

export default AppFooter;
