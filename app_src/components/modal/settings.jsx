import { useModalClose } from "../../modalClose";
import { serializeStyle, validateImportData, hasStyleImportConflicts } from "../../librarySerialization";
import React from "react";
import { FiX, FiSettings, FiEye, FiEyeOff, FiEdit3, FiFileText, FiLayers, FiAlertTriangle, FiChevronUp, FiChevronDown, FiRotateCcw, FiCheck, FiPlayCircle, FiEdit2, FiPlus, FiImage, FiTrash2, FiDatabase, FiHelpCircle, FiFolderPlus, FiLock, FiMonitor, FiType, FiZoomIn } from "react-icons/fi";
import { MdSave, MdTab, MdCenterFocusWeak, MdFormatSize, MdSwapVert, MdOutlineSubject, MdOutlineCallToAction } from "react-icons/md";
import { AiOutlineBorderInner } from "react-icons/ai";
import { FaKeyboard, FaFileExport, FaFileImport } from "react-icons/fa";

import config from "../../config";
import { reloadApp, backupStorage, locale, nativeAlert, nativeConfirm, checkUpdate, readStorage, writeToStorage, deleteStorageFile, getUpdateTestConfig, getUserFonts } from "../../utils";
import { readUxpMigrationState } from "../../uxpMigration";
import { useContext, defaultUiLayout, normalizeUiLayout, normalizeSmartPasteMinScale } from "../../context";
import { normalizeRefontRules } from "../../oneClick/refont";
import { sanitizeTextShapeRTuning } from "../../textShapeR";
import {
  CUSTOM_IMAGE_THEME_ID,
  EDITOR_THEME_PRESETS,
  buildImageThemePreset,
  createCustomThemeFrom,
  getEditorThemePreviewColors,
  normalizeCustomThemes,
} from "../../themePresets";
import {
  clearBackgroundImageData,
  importImageFile,
  normalizeBackgroundImage,
  readBackgroundImageData,
  writeBackgroundImageData,
} from "../../backgroundImage";
import ColorField from "./colorField";
import ThemeEditor from "./themeEditor";
import BackgroundEditor from "./backgroundEditor";
import Shortcut from "./shortCut";
import FontScanPromo from "./fontScanPromo";
import ProfileSettings from "./profileSettings";
import UnsavedChangesDialog from "./unsavedChangesDialog";
import FontViewer from "./fontViewer";
import TextShapeRTraining from "./textShapeRTraining";
import FontFinderLogo from "./fontFinderLogo";
import MissingFontsDialog from "./missingFontsDialog";
import { collectMissingStyleFonts } from "../../fontFinderMatch";
import { getFontViewerStatus } from "../../fontViewerApi";
import { shortcutCommands } from "../../shortcutCommands";
import { isPerfDebugEnabled, setPerfDebugEnabled, reportPerfDebug, resetPerfDebug } from "../../perfDebug";
import { clearTypeRCache, formatCacheBytes, getTypeRCacheInfo } from "../../cepCache";
import { DEFAULT_SETTINGS_TAB, readSettingsTab, writeSettingsTab } from "../../settingsTab";
import { FOOTER_MODE_KEYS } from "../../uiLayout";
import { FOOTER_MODE_ICONS, footerModeLabel } from "../footer/footer";

// Interactive layout mockup: canvas px per real panel px
const LAYOUT_CANVAS_SCALE = 0.3;
const FOOTER_MODE_IDS = Object.keys(FOOTER_MODE_KEYS);
// Sub-elements shown in the inspector for each selectable mockup region
const LAYOUT_BLOCK_ELEMENTS = {
  preview: ["previewCreateButton", "previewAlignButton", "previewSizeControls", "previewNav", "previewWidget"],
  text: ["tabBar"],
  styles: [],
  footer: ["footerHelp", "footerRepo"].concat(FOOTER_MODE_IDS.map((id) => FOOTER_MODE_KEYS[id])),
};
const LAYOUT_ELEMENT_BLOCK = Object.keys(LAYOUT_BLOCK_ELEMENTS).reduce((map, block) => {
  LAYOUT_BLOCK_ELEMENTS[block].forEach((key) => {
    map[key] = block;
  });
  return map;
}, {});
const LAYOUT_BLOCK_ICONS = { preview: FiMonitor, text: MdOutlineSubject, styles: FiLayers, footer: MdOutlineCallToAction };
const LAYOUT_ELEMENT_ICONS = FOOTER_MODE_IDS.reduce((icons, id) => {
  icons[FOOTER_MODE_KEYS[id]] = FOOTER_MODE_ICONS[id];
  return icons;
}, {
  tabBar: MdTab,
  previewCreateButton: AiOutlineBorderInner,
  previewAlignButton: MdCenterFocusWeak,
  previewSizeControls: MdFormatSize,
  previewNav: MdSwapVert,
  previewWidget: FiType,
  footerHelp: FiHelpCircle,
  footerRepo: FiFolderPlus,
});

// On/off switch of the layout inspector (also clickable through its row label)
const LayoutSwitch = ({ checked, onChange, title }) => (
  <span className={"settings-switch" + (checked ? " m-on" : "")} title={title}>
    <input type="checkbox" checked={checked} onChange={onChange} />
    <span className="settings-switch-thumb" />
  </span>
);
// Same cap as normalizeRefontRules
const MAX_REFONT_RULES = 16;
const REFONT_MARKER_MAX_LENGTH = 8;
// The smart paste minimum size is edited in percent of the style size
const minScaleToPercent = (value) => String(Math.round(normalizeSmartPasteMinScale(value) * 100));
// Shortcuts tab: commands grouped by what they act on. A command missing
// here still shows, in the last group, so a new one is never hidden.
const SHORTCUT_GROUPS = [
  { id: "navigation", labelKey: "settingsShortcutGroupNavigation", fallback: "Navigation", commands: ["previous", "next", "previousPage", "nextPage", "previousTab", "nextTab"] },
  { id: "insertion", labelKey: "settingsShortcutGroupInsertion", fallback: "Insertion", commands: ["add", "insertText", "applyMultiple", "keepTextSize"] },
  { id: "centering", labelKey: "settingsGroupCentering", fallback: "Centering", commands: ["center", "centerDouble", "cycleAutoCenter"] },
  { id: "styles", labelKey: "settingsShortcutGroupStyles", fallback: "Styles and size", commands: ["apply", "applyStyle", "previousStyle", "nextStyle", "increase", "decrease", "nextTextSizePreset", "toggleStyleStroke"] },
  { id: "multiBubble", labelKey: "settingsShortcutGroupMultiBubble", fallback: "Multi-bubble", commands: ["toggleMultiBubble", "removeLastSelection", "clearSelections"] },
  { id: "modes", labelKey: "settingsShortcutGroupModes", fallback: "Modes", commands: ["togglePasteOnClick", "toggleTextShapeR", "toggleCleaningLayers"] },
];
const groupShortcutCommands = (commands) => {
  const groups = SHORTCUT_GROUPS.map((group) => ({
    ...group,
    commands: group.commands.map((id) => commands.find((command) => command.id === id)).filter(Boolean),
  }));
  const grouped = new Set(SHORTCUT_GROUPS.reduce((ids, group) => ids.concat(group.commands), []));
  const rest = commands.filter((command) => !grouped.has(command.id));
  groups[groups.length - 1].commands.push(...rest);
  return groups.filter((group) => group.commands.length);
};

const SettingsModal = React.memo(function SettingsModal() {
  const context = useContext((state) => ({
    pastePointText: state.pastePointText,
    ignoreLinePrefixes: state.ignoreLinePrefixes,
    ignoreTags: state.ignoreTags,
    defaultStyleId: state.defaultStyleId,
    language: state.language,
    direction: state.direction,
    middleEast: state.middleEast,
    autoClosePSD: state.autoClosePSD,
    autoScrollStyle: state.autoScrollStyle,
    currentFolderTagPriority: state.currentFolderTagPriority,
    resizeTextBoxOnCenter: state.resizeTextBoxOnCenter,
    checkUpdates: state.checkUpdates,
    autoUpdate: state.autoUpdate,
    multiBubbleMode: state.multiBubbleMode,
    autoCenterMode: state.autoCenterMode,
    smartPaste: state.smartPaste,
    pasteOnClick: state.pasteOnClick,
    smartPasteDistribute: state.smartPasteDistribute,
    smartPasteAutoClean: state.smartPasteAutoClean,
    smartPasteMinScale: state.smartPasteMinScale,
    smartPasteHyphenation: state.smartPasteHyphenation,
    refontRules: state.refontRules,
    showTips: state.showTips,
    showQuickStyleSize: state.showQuickStyleSize,
    inlineTextShapeR: state.inlineTextShapeR,
    dehyphenateTextShapeR: state.dehyphenateTextShapeR,
    styleSizeStep: state.styleSizeStep,
    internalPadding: state.internalPadding,
    interpretMarkdown: state.interpretMarkdown,
    resetLineCounterOnPage: state.resetLineCounterOnPage,
    multiTabEnabled: state.multiTabEnabled,
    editorTheme: state.editorTheme,
    customThemes: state.customThemes,
    pageLineColor: state.pageLineColor,
    backgroundImage: state.backgroundImage,
    shortcut: state.shortcut,
    uiLayout: state.uiLayout,
    tabs: state.tabs,
    textShapeRTuning: state.textShapeRTuning,
    styles: state.styles,
    modalData: state.modalData,
  }));
  // Other windows (the What's new tour) can open a given tab; otherwise the
  // settings reopen on the last tab the user looked at
  const [activeTab, setActiveTab] = React.useState(() => (context.state.modalData && context.state.modalData.tab) || readSettingsTab());
  const [perfDebug, setPerfDebug] = React.useState(isPerfDebugEnabled);
  const [pastePointText, setPastePointText] = React.useState(context.state.pastePointText ? "1" : "");
  const [ignoreLinePrefixes, setIgnoreLinePrefixes] = React.useState(
    context.state.ignoreLinePrefixes.join("\n")
  );
  const [ignoreTags, setIgnoreTags] = React.useState(
    (context.state.ignoreTags || []).join("\n")
  );
  const [defaultStyleId, setDefaultStyleId] = React.useState(context.state.defaultStyleId || "");
  const [language, setLanguage] = React.useState(context.state.language || "auto");
  const [direction, setDirection] = React.useState(context.state.direction || "ltr");
  const [middleEast, setMiddleEast] = React.useState(!!context.state.middleEast);
  const [autoClosePSD, setAutoClosePSD] = React.useState(
    !!context.state.autoClosePSD
  );
  const [autoScrollStyle, setAutoScrollStyle] = React.useState(
    context.state.autoScrollStyle !== false
  );
  const [currentFolderTagPriority, setCurrentFolderTagPriority] = React.useState(
    context.state.currentFolderTagPriority !== false
  );
  const [resizeTextBoxOnCenter, setResizeTextBoxOnCenter] = React.useState(
    !!context.state.resizeTextBoxOnCenter
  );
  const [checkUpdates, setCheckUpdates] = React.useState(
    context.state.checkUpdates !== false
  );
  const [autoUpdate, setAutoUpdate] = React.useState(
    context.state.autoUpdate === true
  );
  const [multiBubbleMode, setMultiBubbleMode] = React.useState(
    !!context.state.multiBubbleMode
  );
  const [autoCenterMode, setAutoCenterMode] = React.useState(
    context.state.autoCenterMode || "off"
  );
  const [smartPaste, setSmartPaste] = React.useState(context.state.smartPaste !== false);
  const [pasteOnClick, setPasteOnClick] = React.useState(context.state.pasteOnClick === true);
  const [smartPasteDistribute, setSmartPasteDistribute] = React.useState(
    context.state.smartPasteDistribute !== false
  );
  const [smartPasteAutoClean, setSmartPasteAutoClean] = React.useState(
    context.state.smartPasteAutoClean === true
  );
  const [smartPasteMinScale, setSmartPasteMinScale] = React.useState(
    () => minScaleToPercent(context.state.smartPasteMinScale)
  );
  const [smartPasteHyphenation, setSmartPasteHyphenation] = React.useState(
    context.state.smartPasteHyphenation || "auto"
  );
  const [refontRules, setRefontRules] = React.useState(() => normalizeRefontRules(context.state.refontRules));
  const [showTips, setShowTips] = React.useState(
    context.state.showTips !== false
  );
  const [showQuickStyleSize, setShowQuickStyleSize] = React.useState(
    context.state.showQuickStyleSize !== false
  );
  const [inlineTextShapeR, setInlineTextShapeR] = React.useState(
    context.state.inlineTextShapeR === true
  );
  const [dehyphenateTextShapeR, setDehyphenateTextShapeR] = React.useState(
    context.state.dehyphenateTextShapeR === true
  );
  const [styleSizeStep, setStyleSizeStep] = React.useState(
    context.state.styleSizeStep !== undefined ? String(context.state.styleSizeStep) : "1"
  );
  const [internalPadding, setInternalPadding] = React.useState(
    context.state.internalPadding !== undefined ? context.state.internalPadding : 10
  );
  const [interpretMarkdown, setInterpretMarkdown] = React.useState(
    context.state.interpretMarkdown !== false
  );
  const [resetLineCounterOnPage, setResetLineCounterOnPage] = React.useState(
    context.state.resetLineCounterOnPage !== false
  );
  const [multiTabEnabled, setMultiTabEnabled] = React.useState(
    context.state.multiTabEnabled !== false
  );
  const [editorTheme, setEditorTheme] = React.useState(context.state.editorTheme || "system");
  // Themes, background and page line color are applied as soon as they change
  // (an appearance editor without a live result is unusable), so they are read
  // straight from the state instead of being drafts waiting for "Save".
  const customThemes = React.useMemo(
    () => normalizeCustomThemes(context.state.customThemes),
    [context.state.customThemes]
  );
  const backgroundImage = React.useMemo(
    () => normalizeBackgroundImage(context.state.backgroundImage),
    [context.state.backgroundImage]
  );
  const pageLineColor = context.state.pageLineColor || "";
  // The picture itself is not part of the state: it lives in its own file
  const [backgroundData, setBackgroundData] = React.useState(() => readBackgroundImageData());
  const [editedThemeId, setEditedThemeId] = React.useState(null);
  const [confirmDeleteThemeId, setConfirmDeleteThemeId] = React.useState(null);
  const [backgroundEditorOpen, setBackgroundEditorOpen] = React.useState(false);
  const [backgroundBusy, setBackgroundBusy] = React.useState(false);
  const [shortcutDraft, setShortcutDraft] = React.useState(() => ({ ...context.state.shortcut }));
  const [multiTabConfirmOpen, setMultiTabConfirmOpen] = React.useState(false);
  const [edited, setEdited] = React.useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = React.useState(false);
  const [fontViewerAvailable, setFontViewerAvailable] = React.useState(false);
  const [missingFontsImport, setMissingFontsImport] = React.useState(null);

  // Interface layout editor (appearance tab)
  const [uiLayout, setUiLayoutLocal] = React.useState(() => normalizeUiLayout(context.state.uiLayout));
  const [previewHeight, setPreviewHeight] = React.useState(
    String(normalizeUiLayout(context.state.uiLayout).sizes.previewHeight)
  );
  const [uiScale, setUiScale] = React.useState(
    String(normalizeUiLayout(context.state.uiLayout).sizes.uiScale)
  );
  const [stylesHeight, setStylesHeight] = React.useState(
    String(readStorage("bottomHeight") || 70)
  );
  const initialStylesHeight = React.useRef(String(readStorage("bottomHeight") || 70));

  // Interactive layout canvas (appearance tab)
  const [selectedLayoutBlock, setSelectedLayoutBlock] = React.useState("preview");
  const [layoutDrag, setLayoutDrag] = React.useState(null);
  const [layoutHoverEl, setLayoutHoverEl] = React.useState(null);
  const layoutCanvasRef = React.useRef(null);
  const layoutDragInfo = React.useRef(null);

  const [cacheInfo, setCacheInfo] = React.useState(getTypeRCacheInfo);

  React.useEffect(() => {
    setShortcutDraft({ ...context.state.shortcut });
  }, [context.state.shortcut]);

  React.useEffect(() => {
    writeSettingsTab(activeTab);
    if (activeTab === "general") setCacheInfo(getTypeRCacheInfo());
  }, [activeTab]);

  // Paste on click and auto clean also have a shortcut / footer toggle: follow
  // a change made there so saving the modal never reverts it
  React.useEffect(() => {
    setPasteOnClick(context.state.pasteOnClick === true);
  }, [context.state.pasteOnClick]);
  // Multi-bubble too, since turning paste on click on there turns it off
  React.useEffect(() => {
    setMultiBubbleMode(!!context.state.multiBubbleMode);
  }, [context.state.multiBubbleMode]);
  React.useEffect(() => {
    setSmartPasteAutoClean(context.state.smartPasteAutoClean === true);
  }, [context.state.smartPasteAutoClean]);

  React.useEffect(() => {
    let active = true;
    getFontViewerStatus()
      .then((status) => {
        if (active) setFontViewerAvailable(status.enabled === true);
        if (active && status.enabled !== true) setActiveTab((tab) => (tab === "fontViewer" ? DEFAULT_SETTINGS_TAB : tab));
      })
      .catch(() => {
        if (active) setFontViewerAvailable(false);
        if (active) setActiveTab((tab) => (tab === "fontViewer" ? DEFAULT_SETTINGS_TAB : tab));
      });
    return () => {
      active = false;
    };
  }, []);

  const shortcutGroups = React.useMemo(
    () => groupShortcutCommands(shortcutCommands).map((group) => ({ ...group, label: locale[group.labelKey] || group.fallback })),
    []
  );

  const shortcutConflicts = React.useMemo(() => {
    const bySignature = {};
    const conflicts = {};
    shortcutCommands.forEach((command) => {
      const keys = shortcutDraft[command.id] || [];
      if (!keys.length) return;
      const signature = Array.from(new Set(keys.map((key) => String(key).toUpperCase())))
        .sort()
        .join("+");
      if (!signature) return;
      if (!bySignature[signature]) bySignature[signature] = [];
      bySignature[signature].push(command);
    });
    Object.values(bySignature).forEach((commands) => {
      if (commands.length < 2) return;
      commands.forEach((command) => {
        conflicts[command.id] = commands
          .filter((other) => other.id !== command.id)
          .map((other) => locale[other.label] || other.id)
          .join(", ");
      });
    });
    return conflicts;
  }, [shortcutDraft]);

  // A modifier-only shortcut whose keys are all contained in one of its target
  // bindings can never be released while that command fires: the command would
  // permanently run in its modified form (e.g. keepTextSize=SHIFT with
  // apply=WIN+SHIFT). Matching is subset-based, so warn about the overlap.
  const shortcutModifierOverlaps = React.useMemo(() => {
    const overlaps = {};
    const normalize = (keys) => (keys || []).map((key) => String(key).toUpperCase());
    shortcutCommands.forEach((command) => {
      if (!command.modifierOnly || !Array.isArray(command.appliesTo)) return;
      const modifierKeys = normalize(shortcutDraft[command.id]);
      if (!modifierKeys.length) return;
      const covered = command.appliesTo.filter((targetId) => {
        const targetKeys = normalize(shortcutDraft[targetId]);
        return targetKeys.length && modifierKeys.every((key) => targetKeys.includes(key));
      });
      if (!covered.length) return;
      const names = covered
        .map((targetId) => {
          const target = shortcutCommands.find((other) => other.id === targetId);
          return (target && locale[target.label]) || targetId;
        })
        .join(", ");
      overlaps[command.id] = names;
      covered.forEach((targetId) => {
        overlaps[targetId] = locale[command.label] || command.id;
      });
    });
    return overlaps;
  }, [shortcutDraft]);

  const changeShortcut = React.useCallback((id, keys) => {
    setShortcutDraft((current) => ({ ...current, [id]: keys }));
    setEdited(true);
  }, []);

  const closeModal = () => {
    context.dispatch({ type: "setModal" });
  };

  const close = () => {
    if (edited) {
      setDiscardConfirmOpen(true);
      return;
    }
    closeModal();
  };
  useModalClose(close);

  const confirmClose = () => {
    setDiscardConfirmOpen(false);
    closeModal();
  };

  const changePastePointText = (e) => {
    setPastePointText(e.target.value);
    setEdited(true);
  };

  const changeLinePrefixes = (e) => {
    setIgnoreLinePrefixes(e.target.value);
    setEdited(true);
  };

  const changeIgnoreTags = (e) => {
    setIgnoreTags(e.target.value);
    setEdited(true);
  };

  const changeDefaultStyle = (e) => {
    setDefaultStyleId(e.target.value);
    setEdited(true);
  };

  const changeLanguage = (e) => {
    setLanguage(e.target.value);
    setEdited(true);
  };

  const changeDirection = (e) => {
    setDirection(e.target.value);
    setEdited(true);
  };

  const changeMiddleEast = (e) => {
    const val = e.target.checked;
    setMiddleEast(val);
    setEdited(true);
  };

  const changeAutoClosePSD = (e) => {
    setAutoClosePSD(e.target.checked);
    setEdited(true);
  };
  const changeAutoScrollStyle = (e) => {
    setAutoScrollStyle(e.target.checked);
    setEdited(true);
  };
  const changeCurrentFolderTagPriority = (e) => {
    setCurrentFolderTagPriority(e.target.checked);
    setEdited(true);
  };
  const changeShowQuickStyleSize = (e) => {
    setShowQuickStyleSize(e.target.checked);
    setEdited(true);
  };

  const changeInlineTextShapeR = (e) => {
    setInlineTextShapeR(e.target.checked);
    setEdited(true);
  };
  const changeStyleSizeStep = (e) => {
    const value = e.target.value;
    if (value === "") {
      setStyleSizeStep("");
      setEdited(true);
      return;
    }
    const normalized = value.replace(",", ".");
    if (!isNaN(normalized) && isFinite(parseFloat(normalized))) {
      setStyleSizeStep(normalized);
      setEdited(true);
    }
  };
  const resetStyleSizeStep = () => {
    if (styleSizeStep === "") {
      setStyleSizeStep(String(context.state.styleSizeStep ?? 1));
    }
  };

  const changeResizeTextBoxOnCenter = (e) => {
    setResizeTextBoxOnCenter(e.target.checked);
    setEdited(true);
  };

  const changeCheckUpdates = (e) => {
    setCheckUpdates(e.target.checked);
    setEdited(true);
  };

  const changeAutoUpdate = (e) => {
    setAutoUpdate(e.target.checked);
    setEdited(true);
  };

  // Multi-bubble and paste on click are exclusive: checking one unchecks the other
  const changeMultiBubbleMode = (e) => {
    setMultiBubbleMode(e.target.checked);
    if (e.target.checked) setPasteOnClick(false);
    setEdited(true);
  };

  const changeShowTips = (e) => {
    setShowTips(e.target.checked);
    setEdited(true);
  };

  const changeDehyphenateTextShapeR = (e) => {
    setDehyphenateTextShapeR(e.target.checked);
    setEdited(true);
  };

  const changeAutoCenterMode = (e) => {
    setAutoCenterMode(e.target.value);
    setEdited(true);
  };

  const changeSmartPaste = (e) => {
    setSmartPaste(e.target.checked);
    setEdited(true);
  };

  const changePasteOnClick = (e) => {
    setPasteOnClick(e.target.checked);
    if (e.target.checked) setMultiBubbleMode(false);
    setEdited(true);
  };

  const changeSmartPasteDistribute = (e) => {
    setSmartPasteDistribute(e.target.checked);
    setEdited(true);
  };

  const changeSmartPasteAutoClean = (e) => {
    setSmartPasteAutoClean(e.target.checked);
    setEdited(true);
  };

  const changeSmartPasteMinScale = (e) => {
    const value = e.target.value;
    // Allow clearing the field while typing; the value is clamped on blur/save
    if (value === "" || /^\d{1,3}$/.test(value)) {
      setSmartPasteMinScale(value);
      setEdited(true);
    }
  };
  const resetSmartPasteMinScale = () => {
    const percent = parseInt(smartPasteMinScale, 10);
    setSmartPasteMinScale(
      Number.isFinite(percent)
        ? String(Math.min(100, Math.max(50, percent)))
        : minScaleToPercent(context.state.smartPasteMinScale)
    );
  };

  const changeSmartPasteHyphenation = (e) => {
    setSmartPasteHyphenation(e.target.value);
    setEdited(true);
  };

  // Conditional refont rules: edited as a draft, normalized on save (rows
  // with an empty marker are dropped there)
  const updateRefontRule = (index, patch) => {
    setRefontRules((rules) => rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
    setEdited(true);
  };
  const changeRefontRuleStyle = (index, value) => {
    const style = (context.state.styles || []).find((item) => String(item.id) === value);
    updateRefontRule(index, { styleId: style ? style.id : null });
  };
  const addRefontRule = () => {
    const firstStyle = (context.state.styles || [])[0];
    setRefontRules((rules) => (rules.length >= MAX_REFONT_RULES ? rules : rules.concat({
      open: "\"",
      close: "\"",
      keepMarkers: false,
      styleId: firstStyle ? firstStyle.id : null,
    })));
    setEdited(true);
  };
  const removeRefontRule = (index) => {
    setRefontRules((rules) => rules.filter((rule, i) => i !== index));
    setEdited(true);
  };

  const changeInternalPadding = (e) => {
    const value = e.target.value;
    // Allow empty string or valid numbers
    if (value === "" || (!isNaN(value) && !isNaN(parseFloat(value)))) {
      setInternalPadding(value);
      setEdited(true);
    }
  };

  const changeInterpretMarkdown = (e) => {
    setInterpretMarkdown(e.target.checked);
    setEdited(true);
  };

  const changeMultiTabEnabled = (e) => {
    setMultiTabEnabled(e.target.checked);
    setEdited(true);
  };

  const changeResetLineCounterOnPage = (e) => {
    setResetLineCounterOnPage(e.target.checked);
    setEdited(true);
  };

  // Keeps the grid selection in sync when the reducer moves the theme itself
  // (deleting the applied theme falls back to the Photoshop one)
  React.useEffect(() => {
    setEditorTheme(context.state.editorTheme);
  }, [context.state.editorTheme]);

  const changeEditorTheme = (theme) => {
    setEditorTheme(theme);
    context.dispatch({ type: "setEditorTheme", theme });
  };

  // Theme list shown in the appearance tab: built-in presets, user themes and
  // the image theme when one has been configured.
  const themeList = React.useMemo(() => {
    const list = EDITOR_THEME_PRESETS.concat(customThemes);
    return backgroundImage ? list.concat([buildImageThemePreset(backgroundImage)]) : list;
  }, [customThemes, backgroundImage]);

  const editedTheme = customThemes.find((theme) => theme.id === editedThemeId) || null;
  const themeToDelete = customThemes.find((theme) => theme.id === confirmDeleteThemeId) || null;

  const commitCustomThemes = (themes, theme) => {
    context.dispatch({ type: "setCustomThemes", themes, theme });
  };

  const createCustomTheme = () => {
    const source = editorTheme === CUSTOM_IMAGE_THEME_ID ? "editor-dark" : editorTheme;
    const theme = createCustomThemeFrom(source, locale.settingsThemeNewName || "My theme");
    setEditedThemeId(theme.id);
    setConfirmDeleteThemeId(null);
    setBackgroundEditorOpen(false);
    setEditorTheme(theme.id);
    commitCustomThemes(customThemes.concat([theme]), theme.id);
  };

  const updateCustomTheme = (theme) => {
    commitCustomThemes(customThemes.map((current) => (current.id === theme.id ? theme : current)));
  };

  const askDeleteCustomTheme = (id) => {
    setConfirmDeleteThemeId(id);
  };

  const deleteCustomTheme = (id) => {
    setConfirmDeleteThemeId(null);
    setEditedThemeId((current) => (current === id ? null : current));
    // The reducer falls back to the Photoshop theme when the applied one goes
    commitCustomThemes(customThemes.filter((theme) => theme.id !== id));
  };

  const openThemeEditor = (id) => {
    setBackgroundEditorOpen(false);
    setConfirmDeleteThemeId(null);
    setEditedThemeId((current) => (current === id ? null : id));
  };

  const openBackgroundEditor = () => {
    setEditedThemeId(null);
    setConfirmDeleteThemeId(null);
    setBackgroundEditorOpen((current) => !current);
  };

  const changePageLineColor = (color) => {
    context.dispatch({ type: "setPageLineColor", color: color || null });
  };

  // File dialogs and reads return promises in the UXP plugin
  const importBackgroundImage = async () => {
    const pathSelect = await window.cep.fs.showOpenDialogEx(false, false, null, null, ["png", "jpg", "jpeg", "webp", "bmp"]);
    const path = pathSelect?.data?.length ? pathSelect.data[0] : null;
    if (!path) return;
    setBackgroundBusy(true);
    importImageFile(path)
      .then((picture) => {
        if (!writeBackgroundImageData(picture.dataUrl)) throw new Error("writeFailed");
        setBackgroundData(picture.dataUrl);
        context.dispatch({
          type: "setBackgroundImage",
          image: {
            ...(backgroundImage || {}),
            name: picture.name,
            width: picture.width,
            height: picture.height,
            // A new picture gets a fresh framing, the previous crop had no
            // meaning for it
            crop: null,
            updatedAt: Date.now(),
          },
        });
        changeEditorTheme(CUSTOM_IMAGE_THEME_ID);
      })
      .catch(() => nativeAlert(locale.settingsBackgroundError || "This image could not be loaded.", locale.errorTitle, true))
      .then(() => setBackgroundBusy(false));
  };

  const updateBackgroundImage = (image) => {
    context.dispatch({ type: "setBackgroundImage", image });
  };

  const removeBackgroundImage = () => {
    clearBackgroundImageData();
    setBackgroundData(null);
    setBackgroundEditorOpen(false);
    // The reducer falls back to "system" when the image theme was selected
    context.dispatch({ type: "setBackgroundImage", image: null });
  };

  const toggleUiElement = (key) => {
    setUiLayoutLocal((current) => normalizeUiLayout({
      ...current,
      visible: { ...current.visible, [key]: current.visible[key] === false },
    }));
    setEdited(true);
  };

  const setUiElements = (keys, value) => {
    setUiLayoutLocal((current) => {
      const visible = { ...current.visible };
      keys.forEach((key) => {
        visible[key] = value;
      });
      return normalizeUiLayout({ ...current, visible });
    });
    setEdited(true);
  };

  const moveUiBlock = (id, direction) => {
    setUiLayoutLocal((current) => {
      const index = current.order.indexOf(id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.order.length) return current;
      const order = current.order.concat([]);
      order[index] = order[target];
      order[target] = id;
      return { ...current, order };
    });
    setEdited(true);
  };

  const changeUiSize = (setter) => (e) => {
    const value = e.target.value;
    if (value === "" || /^[0-9]+$/.test(value)) {
      setter(value);
      setEdited(true);
    }
  };

  // Canvas drag: block reorder ("move") and edge resize ("resize") share
  // the same window listeners; a short move threshold keeps clicks as selection
  const onLayoutDragMove = React.useCallback((e) => {
    const info = layoutDragInfo.current;
    if (!info) return;
    if (info.type === "resize") {
      const delta = ((e.clientY - info.startY) / LAYOUT_CANVAS_SCALE) * info.dir;
      const next = Math.round(Math.min(info.max, Math.max(info.min, info.start + delta)));
      info.setter(String(next));
      setEdited(true);
      return;
    }
    if (!info.moved && Math.abs(e.clientY - info.startY) > 4) {
      info.moved = true;
      setLayoutDrag(info.id);
    }
    if (!info.moved || !layoutCanvasRef.current) return;
    // The DOM order always reflects the latest state, so it is safe to derive
    // the current order from it instead of capturing state in this callback
    const els = Array.from(layoutCanvasRef.current.querySelectorAll("[data-layout-block]"));
    const currentOrder = els.map((el) => el.getAttribute("data-layout-block"));
    let target = 0;
    els.forEach((el) => {
      if (el.getAttribute("data-layout-block") === info.id) return;
      const rect = el.getBoundingClientRect();
      if (e.clientY > rect.top + rect.height / 2) target += 1;
    });
    const rest = currentOrder.filter((id) => id !== info.id);
    const order = rest.slice(0, target).concat(info.id, rest.slice(target));
    if (order.join(",") !== currentOrder.join(",")) {
      setUiLayoutLocal((current) => ({ ...current, order }));
      setEdited(true);
    }
  }, []);

  const onLayoutDragEnd = React.useCallback(() => {
    const info = layoutDragInfo.current;
    layoutDragInfo.current = null;
    setLayoutDrag(null);
    window.removeEventListener("mousemove", onLayoutDragMove);
    window.removeEventListener("mouseup", onLayoutDragEnd);
    if (info && info.type === "move" && !info.moved) {
      setSelectedLayoutBlock(info.id);
    }
  }, [onLayoutDragMove]);

  const startLayoutMove = (e, id) => {
    if (e.button !== 0) return;
    e.preventDefault();
    layoutDragInfo.current = { type: "move", id, startY: e.clientY, moved: false };
    window.addEventListener("mousemove", onLayoutDragMove);
    window.addEventListener("mouseup", onLayoutDragEnd);
  };

  const startLayoutResize = (e, id, dir) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const isPreview = id === "preview";
    layoutDragInfo.current = {
      type: "resize",
      startY: e.clientY,
      start: parseInt(isPreview ? previewHeight : stylesHeight, 10) || (isPreview ? defaultUiLayout.sizes.previewHeight : 70),
      min: isPreview ? 80 : 70,
      max: isPreview ? 300 : 500,
      dir,
      setter: isPreview ? setPreviewHeight : setStylesHeight,
    };
    setSelectedLayoutBlock(id);
    setLayoutDrag("resize");
    window.addEventListener("mousemove", onLayoutDragMove);
    window.addEventListener("mouseup", onLayoutDragEnd);
  };

  React.useEffect(() => () => {
    window.removeEventListener("mousemove", onLayoutDragMove);
    window.removeEventListener("mouseup", onLayoutDragEnd);
  }, [onLayoutDragMove, onLayoutDragEnd]);

  const resetUiLayout = () => {
    setUiLayoutLocal(normalizeUiLayout(null));
    setPreviewHeight(String(defaultUiLayout.sizes.previewHeight));
    setUiScale(String(defaultUiLayout.sizes.uiScale));
    setStylesHeight("70");
    setEdited(true);
  };

  const buildUiLayoutToSave = () => normalizeUiLayout({
    ...uiLayout,
    sizes: {
      previewHeight: previewHeight === "" ? defaultUiLayout.sizes.previewHeight : previewHeight,
      uiScale: uiScale === "" ? defaultUiLayout.sizes.uiScale : uiScale,
    },
  });

  const save = (e) => {
    e.preventDefault();
    // Disabling multi-tab with several open tabs needs an in-app confirmation
    if (
      !multiTabEnabled &&
      context.state.multiTabEnabled !== false &&
      (context.state.tabs || []).length > 1
    ) {
      setMultiTabConfirmOpen(true);
      return;
    }
    applySave();
  };

  const confirmDisableMultiTab = () => {
    setMultiTabConfirmOpen(false);
    applySave();
  };

  const cancelDisableMultiTab = () => {
    setMultiTabEnabled(true);
    setMultiTabConfirmOpen(false);
  };

  const applySave = () => {
    if (pastePointText !== context.state.pastePointText) {
      context.dispatch({
        type: "setPastePointText",
        isPoint: !!pastePointText,
      });
    }
    if (ignoreLinePrefixes !== context.state.ignoreLinePrefixes.join("\n")) {
      context.dispatch({
        type: "setIgnoreLinePrefixes",
        data: ignoreLinePrefixes,
      });
    }
    if (ignoreTags !== (context.state.ignoreTags || []).join("\n")) {
      context.dispatch({
        type: "setIgnoreTags",
        data: ignoreTags,
      });
    }
    if (defaultStyleId !== context.state.defaultStyleId) {
      context.dispatch({
        type: "setDefaultStyleId",
        id: defaultStyleId,
      });
    }
    if (language !== context.state.language) {
      context.dispatch({
        type: "setLanguage",
        lang: language,
      });
      setTimeout(() => reloadApp(), 100);
    }
    if (direction !== context.state.direction) {
      context.dispatch({
        type: "setDirection",
        direction,
      });
    }
    if (middleEast !== context.state.middleEast) {
      context.dispatch({
        type: "setMiddleEast",
        value: middleEast,
      });
    }
    if (autoClosePSD !== context.state.autoClosePSD) {
      context.dispatch({
        type: "setAutoClosePSD",
        value: autoClosePSD,
      });
    }

    if (autoScrollStyle !== context.state.autoScrollStyle) {
      context.dispatch({
        type: "setAutoScrollStyle",
        value: autoScrollStyle,
      });
    }
    if (currentFolderTagPriority !== context.state.currentFolderTagPriority) {
      context.dispatch({
        type: "setCurrentFolderTagPriority",
        value: currentFolderTagPriority,
      });
    }
    if (resizeTextBoxOnCenter !== context.state.resizeTextBoxOnCenter) {
      context.dispatch({
        type: "setResizeTextBoxOnCenter",
        value: resizeTextBoxOnCenter,
      });
    }
    if (checkUpdates !== context.state.checkUpdates) {
      context.dispatch({
        type: "setCheckUpdates",
        value: checkUpdates,
      });
    }
    if (autoUpdate !== context.state.autoUpdate) {
      context.dispatch({
        type: "setAutoUpdate",
        value: autoUpdate,
      });
    }
    if (multiBubbleMode !== context.state.multiBubbleMode) {
      context.dispatch({
        type: "setMultiBubbleMode",
        value: multiBubbleMode,
      });
    }
    if (autoCenterMode !== (context.state.autoCenterMode || "off")) {
      context.dispatch({
        type: "setAutoCenterMode",
        value: autoCenterMode,
      });
    }
    if (smartPaste !== (context.state.smartPaste !== false)) {
      context.dispatch({ type: "setSmartPaste", value: smartPaste });
    }
    if (pasteOnClick !== (context.state.pasteOnClick === true)) {
      context.dispatch({ type: "setPasteOnClick", value: pasteOnClick });
    }
    if (smartPasteDistribute !== (context.state.smartPasteDistribute !== false)) {
      context.dispatch({ type: "setSmartPasteDistribute", value: smartPasteDistribute });
    }
    if (smartPasteAutoClean !== (context.state.smartPasteAutoClean === true)) {
      context.dispatch({ type: "setSmartPasteAutoClean", value: smartPasteAutoClean });
    }
    const minScalePercent = parseInt(smartPasteMinScale, 10);
    if (Number.isFinite(minScalePercent)) {
      const minScale = normalizeSmartPasteMinScale(minScalePercent / 100);
      if (minScale !== context.state.smartPasteMinScale) {
        context.dispatch({ type: "setSmartPasteMinScale", value: minScale });
      }
    }
    if (smartPasteHyphenation !== (context.state.smartPasteHyphenation || "auto")) {
      context.dispatch({ type: "setSmartPasteHyphenation", value: smartPasteHyphenation });
    }
    const refontRulesToSave = normalizeRefontRules(refontRules);
    if (JSON.stringify(refontRulesToSave) !== JSON.stringify(normalizeRefontRules(context.state.refontRules))) {
      context.dispatch({ type: "setRefontRules", rules: refontRulesToSave });
    }
    if (showTips !== context.state.showTips) {
      context.dispatch({
        type: "setShowTips",
        value: showTips,
      });
    }
    if (showQuickStyleSize !== context.state.showQuickStyleSize) {
      context.dispatch({
        type: "setShowQuickStyleSize",
        value: showQuickStyleSize,
      });
    }
    if (inlineTextShapeR !== context.state.inlineTextShapeR) {
      context.dispatch({
        type: "setInlineTextShapeR",
        value: inlineTextShapeR,
      });
    }
    if (dehyphenateTextShapeR !== context.state.dehyphenateTextShapeR) {
      context.dispatch({
        type: "setDehyphenateTextShapeR",
        value: dehyphenateTextShapeR,
      });
    }
    const parsedStyleSizeStep = parseFloat(String(styleSizeStep).replace(",", "."));
    if (
      Number.isFinite(parsedStyleSizeStep) &&
      parsedStyleSizeStep > 0 &&
      parsedStyleSizeStep !== context.state.styleSizeStep
    ) {
      context.dispatch({
        type: "setStyleSizeStep",
        step: parsedStyleSizeStep,
      });
    }
    if (internalPadding !== context.state.internalPadding) {
      context.dispatch({
        type: "setInternalPadding",
        value: internalPadding,
      });
    }
    if (interpretMarkdown !== context.state.interpretMarkdown) {
      context.dispatch({
        type: "setInterpretMarkdown",
        value: interpretMarkdown,
      });
    }
    if (resetLineCounterOnPage !== context.state.resetLineCounterOnPage) {
      context.dispatch({
        type: "setResetLineCounterOnPage",
        value: resetLineCounterOnPage,
      });
    }
    if (multiTabEnabled !== (context.state.multiTabEnabled !== false)) {
      context.dispatch({ type: "setMultiTabEnabled", value: multiTabEnabled });
    }
    // Themes, background image and page line color are not part of the draft:
    // they are applied and persisted as soon as they change.
    const layoutToSave = buildUiLayoutToSave();
    if (JSON.stringify(layoutToSave) !== JSON.stringify(normalizeUiLayout(context.state.uiLayout))) {
      context.dispatch({ type: "setUiLayout", layout: layoutToSave });
    }
    if (stylesHeight !== initialStylesHeight.current && stylesHeight !== "") {
      const parsedStylesHeight = Math.min(500, Math.max(70, parseInt(stylesHeight, 10) || 70));
      writeToStorage({ bottomHeight: parsedStylesHeight });
      // The styles block height is applied imperatively by the resize logic
      setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
    }
    context.dispatch({
      type: "updateShortcut",
      shortcut: shortcutDraft,
    });

    closeModal();
  };

  const importSettings = async () => {
    const pathSelect = await window.cep.fs.showOpenDialogEx(true, false, null, null, ["json"]);
    if (!pathSelect?.data?.length) return false;
    let foldersImported = 0;
    let backedUp = false;
    const importedStyles = [];
    for (const path of pathSelect.data) {
      const result = await window.cep.fs.readFile(path);
      if (result.err) {
        nativeAlert(locale.errorImportStyles, locale.errorTitle, true);
      } else {
        try {
          const data = validateImportData(JSON.parse(result.data));
          if (!backedUp) {
            if (!backupStorage()) { nativeAlert(locale.storageWarning, locale.errorTitle, true); continue; }
            backedUp = true;
          }
          if (data.pastePointText === undefined && data.textItemKind !== undefined) {
            data.pastePointText = !!data.textItemKind;
          }
          if (data.typerTextShapeRTuning) {
            // A shared TextShapeR learning file: route it to its own flow so
            // it never falls through to the full-settings import (which
            // replaces storage and reloads the panel)
            const tuningValue = sanitizeTextShapeRTuning(data.typerTextShapeRTuning);
            if (!tuningValue.samples) throw new Error("format");
            context.dispatch({ type: "setTextShapeRTuning", value: tuningValue });
            nativeAlert(locale.textShapeRTuningImportSuccess || "TextShapeR learning imported — suggestions now follow this style.", locale.successTitle, false);
          } else if (data.exportedStyles) {
            const folderId = Math.random().toString(36).substring(2, 8);
            const importedAt = Date.now();
            const dataFolder = { id: folderId, name: data.name };
            const styles = data.exportedStyles.map((style) => ({
                ...serializeStyle(style),
                name: style.name,
                id: Math.random().toString(36).substring(2, 8),
                folder: folderId,
                textType: style.textType || "inherit",
                textProps: style.textProps,
                prefixes: style.prefixes || [],
                prefixColor: style.prefixColor,
                stroke: style.stroke,
                edited: importedAt,
            }));
            context.dispatch({ type: "importStyleFolder", folder: dataFolder, styles });
            importedStyles.push(...styles);
            foldersImported++;
          } else if (
            data.folders &&
            data.styles &&
            data.includesSettings !== true &&
            !data.ignoreLinePrefixes &&
            !data.ignoreTags &&
            !data.defaultStyleId &&
            !data.language &&
            !data.autoClosePSD &&
            !data.autoScrollStyle &&
            !data.pastePointText &&
            !data.textItemKind
          ) {
            const idMap = {};
            const foldersWithNewIds = data.folders.map((folder) => {
              const newId = Math.random().toString(36).substring(2, 8);
              idMap[folder.id] = newId;
              return { folder, newId };
            });
            const folders = foldersWithNewIds.map(({ folder, newId }) => ({
              id: newId,
              name: folder.name,
              parentId: folder.parentId ? idMap[folder.parentId] || null : null,
              order: typeof folder.order === "number" ? folder.order : undefined,
            }));
            const importedAt = Date.now();
            const styles = data.styles.map((style) => ({
              ...serializeStyle(style),
              id: Math.random().toString(36).substring(2, 8),
              name: style.name,
              folder: style.folder ? idMap[style.folder] : null,
              textType: style.textType || "inherit",
              textProps: style.textProps,
              prefixes: style.prefixes || [],
              prefixColor: style.prefixColor,
              stroke: style.stroke,
              edited: importedAt,
            }));
            context.dispatch({ type: "importStyleLibrary", folders, styles });
            importedStyles.push(...styles);
            foldersImported += folders.length;
          } else {
            const currentStyles = context.getState().styles;
            const keepExistingStyles = data.styles && hasStyleImportConflicts(currentStyles, data.styles)
              ? await new Promise(resolve => nativeConfirm(locale.settingsImportReplace, locale.confirmTitle, resolve))
              : false;
            context.dispatch({ type: "import", data, keepExistingStyles });
            setTimeout(() => reloadApp(), 100);
            closeModal();
          }
        } catch (error) {
          nativeAlert(locale.errorImportStyles, locale.errorTitle, true);
        }
      }
    }
    if (foldersImported > 0) {
      const message = foldersImported > 1 ? locale.importFoldersSuccess : locale.importFolderSuccess;
      // An empty list means Photoshop's fonts are not known yet: no warning
      const installedFonts = getUserFonts();
      const missingFonts = installedFonts.length ? collectMissingStyleFonts(importedStyles, installedFonts) : [];
      if (missingFonts.length) setMissingFontsImport({ fonts: missingFonts, message });
      else nativeAlert(message, locale.successTitle, false);
    }
  };

  const exportSettings = () => {
    context.dispatch({ type: "setModal", modal: "export" });
  };

  // TextShapeR learning travels in its own file, on purpose separate from the
  // style export flow: sharing a learned line-break style must not drag the
  // sender's folders, styles, or preferences along with it
  const exportShapeTuning = async () => {
    const tuningState = context.state.textShapeRTuning;
    if (!tuningState || !tuningState.samples) {
      nativeAlert(locale.textShapeRTuningExportEmpty || "Nothing learned yet — use the star button on TextShapeR suggestions first.", locale.errorTitle, true);
      return;
    }
    const pathSelect = await window.cep.fs.showSaveDialogEx(false, false, ["json"], "typer-textshaper-style.json");
    if (!pathSelect?.data) return;
    const data = {
      typerTextShapeRTuning: tuningState,
      version: config.appVersion,
      exported: new Date(),
    };
    const result = await window.cep.fs.writeFile(pathSelect.data, JSON.stringify(data));
    if (result.err) {
      nativeAlert(locale.textShapeRTuningImportError || "This file does not contain TextShapeR learning data.", locale.errorTitle, true);
    }
  };

  const importShapeTuning = async () => {
    const pathSelect = await window.cep.fs.showOpenDialogEx(false, false, null, null, ["json"]);
    if (!pathSelect?.data?.length) return;
    const result = await window.cep.fs.readFile(pathSelect.data[0]);
    if (result.err) {
      nativeAlert(locale.textShapeRTuningImportError || "This file does not contain TextShapeR learning data.", locale.errorTitle, true);
      return;
    }
    try {
      const data = JSON.parse(result.data);
      const raw = data.typerTextShapeRTuning;
      if (!raw || typeof raw !== "object") throw new Error("format");
      // Sanitize through the algorithm's own gate so a foreign or hand-edited
      // file can never park invalid knobs, weights, or exemplars in storage
      const tuningValue = sanitizeTextShapeRTuning(raw);
      if (!tuningValue.samples) throw new Error("format");
      context.dispatch({ type: "setTextShapeRTuning", value: tuningValue });
      nativeAlert(locale.textShapeRTuningImportSuccess || "TextShapeR learning imported — suggestions now follow this style.", locale.successTitle, false);
    } catch (error) {
      nativeAlert(locale.textShapeRTuningImportError || "This file does not contain TextShapeR learning data.", locale.errorTitle, true);
    }
  };

  const openWalkthrough = () => {
    context.dispatch({ type: "setModal", modal: "walkthrough", data: { source: "settings" } });
  };

  const [featureTipsReset, setFeatureTipsReset] = React.useState(false);
  const resetFeatureTips = () => {
    context.dispatch({ type: "resetFeatureTips" });
    setFeatureTipsReset(true);
  };

  const openWhatsNew = () => {
    context.dispatch({ type: "setModal", modal: "whatsNew", data: { source: "settings" } });
  };

  // Legacy panel: the switch to the new TypeR (UXP), when Photoshop can run it
  const uxpMigration = React.useMemo(() => {
    try {
      return readUxpMigrationState(getUpdateTestConfig());
    } catch (error) {
      return { eligibility: "uxp", forced: false };
    }
  }, []);
  const openUxpMigration = () => {
    context.dispatch({ type: "setModal", modal: "uxpMigration", data: { forced: uxpMigration.forced } });
  };

  const checkUpdatesNow = () => {
    checkUpdate(config.appVersion).then((data) => {
      if (data) {
        context.dispatch({ type: "setModal", modal: "update", data });
      } else {
        nativeAlert(locale.updateNoUpdate, locale.successTitle, false);
      }
    }).catch(() => nativeAlert(locale.updateCheckFailed, locale.errorTitle, true));
  };

  const resetStorage = () => {
    nativeConfirm(
      locale.settingsResetProfileConfirm,
      locale.confirmTitle || "Confirmation",
      (confirmed) => {
        if (!confirmed) return;
        const success = deleteStorageFile();
        if (success) {
          nativeAlert(
            locale.settingsResetProfileSuccess,
            locale.successTitle,
            false
          );
          setTimeout(() => reloadApp(), 300);
        } else {
          nativeAlert(
            locale.settingsResetProfileError,
            locale.errorTitle,
            true
          );
        }
      }
    );
  };

  const clearCache = () => {
    const size = formatCacheBytes(cacheInfo.bytes);
    nativeConfirm(
      (locale.settingsClearCacheConfirm || "Clear {size} of TypeR cache? Your texts, tabs, settings, styles, themes, and saved states will be kept.")
        .replace("{size}", size),
      locale.confirmTitle || "Confirmation",
      (confirmed) => {
        if (!confirmed) return;
        const result = clearTypeRCache();
        setCacheInfo(getTypeRCacheInfo());
        if (!result.supported) {
          nativeAlert(
            locale.settingsClearCacheError || "Unable to access the TypeR cache.",
            locale.errorTitle,
            true
          );
        } else if (result.ok) {
          nativeAlert(
            (locale.settingsClearCacheSuccess || "{size} of cache cleared.")
              .replace("{size}", formatCacheBytes(result.clearedBytes)),
            locale.successTitle,
            false
          );
        } else {
          nativeAlert(
            (locale.settingsClearCachePartial || "{cleared} cleared; {remaining} is still in use. Restart Photoshop, then try again.")
              .replace("{cleared}", formatCacheBytes(result.clearedBytes))
              .replace("{remaining}", formatCacheBytes(result.remainingBytes)),
            locale.errorTitle,
            true
          );
        }
      }
    );
  };

  const resetShortcuts = () => {
    nativeConfirm(
      locale.settingsResetShortcutsConfirm || "Reset shortcuts to default?",
      locale.confirmTitle || "Confirmation",
      (confirmed) => {
        if (!confirmed) return;
        context.dispatch({ type: "resetShortcut" });
      }
    );
  };

  // Performance logger: writes its own flag, never goes through the panel
  // storage, so it can be switched on even to diagnose the storage itself
  const changePerfDebug = (e) => {
    setPerfDebug(setPerfDebugEnabled(e.target.checked));
  };

  const showPerfReport = () => {
    const report = reportPerfDebug();
    const slowest = report.hostCalls[0];
    nativeAlert(
      [
        `${locale.settingsPerfDebugReportClicks || "Click to paint"}: ${report.clickToPaint.avgMs}ms (max ${report.clickToPaint.worstMs}ms, ${report.clickToPaint.samples})`,
        `${locale.settingsPerfDebugReportHost || "Slowest Photoshop call"}: ${slowest ? `${slowest.name} ${slowest.avgMs}ms x${slowest.calls}` : "-"}`,
        `${locale.settingsPerfDebugReportFrames || "Long frames"}: ${report.longFrames.count} (max ${report.longFrames.worstMs}ms)`,
      ].join("\n"),
      locale.settingsPerfDebugReport || "Performance report",
      false
    );
  };

  // Work tabs first (in the order of the job), then the panel and the data
  const tabs = [
    { id: "general", label: locale.settingsTabGeneral || "General", icon: FiSettings },
    { id: "insertion", label: locale.settingsTabInsertion || "Insertion", icon: FiEdit3 },
    { id: "script", label: locale.settingsTabScript || "Script", icon: FiFileText },
    { id: "styles", label: locale.settingsTabStyles || "Styles", icon: FiLayers },
    { id: "shortcuts", label: locale.settingsTabShortcuts || "Shortcuts", icon: FaKeyboard },
    { id: "appearance", label: locale.settingsTabAppearance || "Appearance", icon: FiEye },
    { id: "data", label: locale.settingsTabData || "Data", icon: FiDatabase },
    {
      id: "fontViewer",
      label: locale.settingsTabFontViewer,
      icon: FontFinderLogo,
      disabled: !fontViewerAvailable,
      disabledTitle: locale.fontViewerUnavailable,
    },
  ];

  // Shared markup for a toggle row (checkbox + label + optional hint). The
  // options that only matter while it is checked sit indented under it.
  const renderToggle = (checked, onChange, label, hint, children) => (
    <React.Fragment>
      <div className="settings-checkbox-item">
        <label className="settings-checkbox-label">
          <input type="checkbox" checked={checked} onChange={onChange} />
          <div className="settings-checkbox-custom"></div>
          <div className="settings-checkbox-content">
            <span>{label}</span>
            {hint ? <div className="settings-checkbox-hint">{hint}</div> : null}
          </div>
        </label>
      </div>
      {checked && children ? <div className="settings-checkbox-children">{children}</div> : null}
    </React.Fragment>
  );

  const renderTabContent = () => {
    switch (activeTab) {
      case "general":
        return (
          <div className="fields">
            <div className="settings-group">
              <div className="settings-group-title">{locale.settingsLanguageLabel}</div>
              <div className="field">
                <div className="field-input">
                  <select value={language} onChange={changeLanguage} className="topcoat-textarea">
                    {Object.entries(config.languages).map(([code, name]) => (
                      <option key={code} value={code}>
                        {code === "auto" ? locale.settingsLanguageAuto : name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div className="settings-group">
              <div className="settings-group-title">{locale.settingsGroupOnboarding || "Getting started"}</div>
              <div className="settings-checkbox-grid">
                {renderToggle(
                  showTips,
                  changeShowTips,
                  locale.settingsShowTipsLabel || "Show tips",
                  locale.settingsShowTipsHint || "Display tips in the interface (multi-bubble hints, etc.)"
                )}
              </div>
              <div className="field">
                <button type="button" className="topcoat-button--large" onClick={resetFeatureTips} disabled={featureTipsReset}>
                  {featureTipsReset
                    ? (locale.settingsResetFeatureTipsDone || "Tips will show again")
                    : (locale.settingsResetFeatureTips || "Show tips again")}
                </button>
              </div>
              <div className="field-descr">
                {locale.settingsResetFeatureTipsHint || "Brings back the \"Did you know?\" tips you have already seen."}
              </div>
              <div className="field">
                <button type="button" className="topcoat-button--large" onClick={openWalkthrough}>
                  {locale.settingsOpenWalkthrough || "Open walkthrough"}
                </button>
              </div>
              <div className="field-descr">
                {locale.settingsOpenWalkthroughHint || "Replay the first-time guide for the complete TypeR workflow."}
              </div>
              <div className="field">
                <button type="button" className="topcoat-button--large" onClick={openWhatsNew}>
                  {locale.settingsOpenWhatsNew || "What's new in 3.0"}
                </button>
              </div>
              <div className="field-descr">
                {locale.settingsOpenWhatsNewHint || "Replay the tour of the main 3.0 features."}
              </div>
            </div>
            <div className="settings-group">
              <div className="settings-group-title">{locale.settingsGroupAppUpdates || "Updates"}</div>
              <div className="settings-checkbox-grid">
                {renderToggle(
                  checkUpdates,
                  changeCheckUpdates,
                  locale.settingsCheckUpdatesLabel,
                  locale.settingsCheckUpdatesHint || "Automatically checks for available updates",
                  renderToggle(
                    autoUpdate,
                    changeAutoUpdate,
                    locale.settingsAutoUpdateLabel || "Install updates automatically",
                    locale.settingsAutoUpdateHint || "New versions install silently in the background. TypeR reloads by itself, or at the next Photoshop restart when it cannot"
                  )
                )}
              </div>
              <div className="field">
                <button type="button" className="topcoat-button--large" onClick={checkUpdatesNow}>
                  {locale.settingsCheckUpdatesButton}
                </button>
              </div>
              {(uxpMigration.eligibility === "ok" || uxpMigration.forced) && (
              <div className="field">
                <div className="settings-checkbox-hint">
                  {locale.settingsUxpMigrationHint || "Your Photoshop can run the new TypeR (UXP), the faster version of the panel."}
                </div>
                <button type="button" className="topcoat-button--large" onClick={openUxpMigration}>
                  {locale.settingsUxpMigrationButton || "Switch to the new TypeR"}
                </button>
              </div>
              )}
              {uxpMigration.eligibility === "installed" && !uxpMigration.forced && (
              <div className="field">
                <div className="settings-checkbox-hint">
                  {locale.settingsUxpMigrationInstalled || "The new TypeR (UXP) is installed: open it from the Plugins > TypeR menu."}
                </div>
              </div>
              )}
            </div>
            <div className="settings-group">
              <div className="settings-group-title">{locale.settingsGroupMaintenance || "Maintenance"}</div>
              <div className="field">
                <button
                  type="button"
                  className="topcoat-button--large"
                  onClick={clearCache}
                  disabled={!cacheInfo.supported || cacheInfo.bytes === 0}
                >
                  <FiTrash2 size={18} /> {locale.settingsClearCache || "Clear cache"}
                </button>
              </div>
              <div className="field-descr">
                {(locale.settingsCacheAccumulated || "Accumulated cache: {size}")
                  .replace("{size}", formatCacheBytes(cacheInfo.bytes))}
              </div>
              <div className="field-descr">
                {locale.settingsClearCacheHint || "Deletes TypeR's temporary browser files without touching texts, tabs, settings, styles, themes, or saved states."}
              </div>
              <div className="settings-checkbox-grid">
                {renderToggle(
                  perfDebug,
                  changePerfDebug,
                  locale.settingsPerfDebugLabel || "Performance logger",
                  locale.settingsPerfDebugHint ||
                    "Measures Photoshop calls, redraws and click latency. Leave it off unless the panel feels slow.",
                  <div className="field" style={{ display: "flex", gap: 8 }}>
                    <button type="button" className="topcoat-button--large" onClick={showPerfReport}>
                      {locale.settingsPerfDebugReport || "Performance report"}
                    </button>
                    <button type="button" className="topcoat-button--large" onClick={resetPerfDebug}>
                      {locale.settingsPerfDebugReset || "Reset counters"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        );

      case "insertion":
        return (
          <div className="fields">
            <div className="settings-group">
              <div className="settings-group-title">{locale.settingsGroupPaste || "Paste"}</div>
              <div className="field">
                <div className="field-label">{locale.settingsTextItemKindLabel}</div>
                <div className="field-input">
                  <select value={pastePointText} onChange={changePastePointText} className="topcoat-textarea">
                    <option value="">{locale.settingsTextItemKindBox}</option>
                    <option value="1">{locale.settingsTextItemKindPoint}</option>
                  </select>
                </div>
              </div>
              <div className="settings-checkbox-grid">
                {renderToggle(
                  smartPaste,
                  changeSmartPaste,
                  <React.Fragment>
                    {locale.settingsSmartPasteLabel || "Smart paste"}
                    <b className="settings-new-badge">{locale.settingsNewBadge || "New"}</b>
                  </React.Fragment>,
                  locale.settingsSmartPasteHelp || "Paste fits the text to the real shape of the bubble: the style size is the maximum, text turns white on black bubbles, and styles marked shout or narration are used for those bubbles.",
                  <React.Fragment>
                    {renderToggle(
                      smartPasteDistribute,
                      changeSmartPasteDistribute,
                      locale.settingsSmartPasteDistributeLabel || "Split lines across connected bubbles",
                      locale.settingsSmartPasteDistributeHelp || "Double or triple bubbles receive the next lines, one per part."
                    )}
                    {renderToggle(
                      smartPasteAutoClean,
                      changeSmartPasteAutoClean,
                      locale.settingsSmartPasteAutoCleanLabel || "Auto clean",
                      locale.settingsSmartPasteAutoCleanHelp || "Paints a white or black fill under the text to cover the original lettering (plain white or black bubbles only)."
                    )}
                    <div className="field">
                      <div className="field-label">{locale.settingsSmartPasteMinScaleLabel || "Minimum text size (%)"}</div>
                      <div className="field-input">
                        <input
                          type="number"
                          min="50"
                          max="100"
                          step="5"
                          value={smartPasteMinScale}
                          onChange={changeSmartPasteMinScale}
                          onBlur={resetSmartPasteMinScale}
                          className="topcoat-text-input--large"
                        />
                      </div>
                      <div className="field-descr">
                        {locale.settingsSmartPasteMinScaleHelp || "To fit a small bubble, the text may shrink down to this share of the style size (50-100)."}
                      </div>
                    </div>
                    <div className="field">
                      <div className="field-label">{locale.settingsSmartPasteHyphenationLabel || "Hyphenation"}</div>
                      <div className="field-input">
                        <select value={smartPasteHyphenation} onChange={changeSmartPasteHyphenation} className="topcoat-textarea">
                          <option value="auto">{locale.settingsHyphenationAuto || "Automatic (interface language)"}</option>
                          <option value="fr">{locale.settingsHyphenationFr || "French"}</option>
                          <option value="en">{locale.settingsHyphenationEn || "English"}</option>
                          <option value="off">{locale.settingsHyphenationOff || "Off"}</option>
                        </select>
                      </div>
                    </div>
                  </React.Fragment>
                )}
                {renderToggle(
                  pasteOnClick,
                  changePasteOnClick,
                  locale.settingsPasteOnClickLabel || "Paste on click",
                  locale.settingsPasteOnClickHelp || "A Magic Wand click or a rectangle/lasso selection pastes the current line right away, without pressing Paste."
                )}
                {renderToggle(
                  multiBubbleMode,
                  changeMultiBubbleMode,
                  locale.multiBubbleModeToggle || "Multi-Bubble Mode",
                  <React.Fragment>
                    {locale.multiBubbleModeHint || "Allows capturing multiple selections to insert multiple texts at once"}
                    <button
                      type="button"
                      className="settings-help-badge"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        window.cep && window.cep.util && window.cep.util.openURLInDefaultBrowser('https://youtu.be/gmIh-eEj2HY');
                      }}
                      title={locale.multiBubbleModeHowToUse || "How to use"}
                    >
                      <FiPlayCircle size={12} />
                      {locale.multiBubbleModeHowToUse || "How to use"}
                    </button>
                  </React.Fragment>
                )}
              </div>
            </div>
            <div className="settings-group">
              <div className="settings-group-title">{locale.settingsGroupCentering || "Centering"}</div>
              <div className="field">
                <div className="field-label">{locale.settingsAutoCenterLabel || "Center after paste"}</div>
                <div className="field-input">
                  <select value={autoCenterMode} onChange={changeAutoCenterMode} className="topcoat-textarea">
                    <option value="off">{locale.settingsAutoCenterOff || "Off"}</option>
                    <option value="single">{locale.settingsAutoCenterSingle || "Center in the bubble"}</option>
                    <option value="multi">{locale.settingsAutoCenterMulti || "Multi center (detects double bubbles)"}</option>
                  </select>
                </div>
                <div className="field-descr">
                  {locale.settingsAutoCenterHint || "Each pasted text is re-centered in the bubble detected around it. Multi center also recognizes double bubbles and splits them between their texts: a text already in the bubble moves to its part unless its layer is locked. Also switchable from the footer."}
                </div>
              </div>
              <div className="settings-checkbox-grid">
                {renderToggle(
                  resizeTextBoxOnCenter,
                  changeResizeTextBoxOnCenter,
                  locale.settingsResizeTextBoxOnCenterLabel || "Fit text box to bubble when centering",
                  locale.settingsResizeTextBoxOnCenterHint || "Fits the text box to the bubble before centering without changing the font size."
                )}
              </div>
              <div className="field">
                <div className="field-label">{locale.settingsInternalPaddingLabel || "Internal padding (px)"}</div>
                <div className="field-input">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={internalPadding}
                    onChange={changeInternalPadding}
                    className="topcoat-text-input--large"
                  />
                </div>
                <div className="field-descr">{locale.settingsInternalPaddingHint || "Internal space to prevent text from touching bubble edges (0-100 pixels)"}</div>
              </div>
            </div>
            <div className="settings-group">
              <div className="settings-group-title">TextShapeR</div>
              <div className="settings-checkbox-grid">
                {renderToggle(
                  inlineTextShapeR,
                  changeInlineTextShapeR,
                  <React.Fragment>
                    {locale.settingsInlineTextShapeRLabel || "TextShapeR"}
                    <b className="settings-new-badge">{locale.settingsNewBadge || "New"}</b>
                  </React.Fragment>,
                  locale.settingsInlineTextShapeRHint || "Shows text shape suggestions directly in the main panel. This may impact performance.",
                  renderToggle(
                    dehyphenateTextShapeR,
                    changeDehyphenateTextShapeR,
                    locale.settingsDehyphenateLabel || "TextShapeR: join words split by hyphenation",
                    locale.settingsDehyphenateHint || "When shaping text, joins words split across line breaks. Turn off if real compound words should stay separated."
                  )
                )}
              </div>
            </div>
            <TextShapeRTraining onImportLearning={importShapeTuning} onExportLearning={exportShapeTuning} />
          </div>
        );

      case "script":
        return (
          <div className="fields">
            <div className="settings-group">
              <div className="settings-group-title">{locale.settingsGroupTextScript || "Script & tags"}</div>
              <div className="field">
                <div className="field-label">{locale.settingsLinePrefixesLabel}</div>
                <div className="field-input">
                  <textarea rows={2} value={ignoreLinePrefixes} onChange={changeLinePrefixes} className="topcoat-textarea" />
                </div>
                <div className="field-descr">{locale.settingsLinePrefixesDescr}</div>
              </div>
              <div className="field">
                <div className="field-label">{locale.settingsIgnoreTagsLabel}</div>
                <div className="field-input">
                  <textarea rows={2} value={ignoreTags} onChange={changeIgnoreTags} className="topcoat-textarea" />
                </div>
                <div className="field-descr">{locale.settingsIgnoreTagsDescr}</div>
              </div>
              <div className="settings-checkbox-grid">
                {renderToggle(
                  interpretMarkdown,
                  changeInterpretMarkdown,
                  locale.settingsMarkdownLabel || "Interpret markdown (bold/italic)",
                  locale.settingsMarkdownHint || "Convert markdown and rich text on paste and apply bold/italic in the text block."
                )}
              </div>
            </div>
            <div className="settings-group">
              <div className="settings-group-title">{locale.settingsGroupPages || "Pages"}</div>
              <div className="settings-checkbox-grid">
                {renderToggle(
                  resetLineCounterOnPage,
                  changeResetLineCounterOnPage,
                  locale.settingsResetLineCounterOnPageLabel || "Reset line counter on page markers",
                  locale.settingsResetLineCounterOnPageHint || "Restarts text line numbering at 1 after each Page N marker."
                )}
                {renderToggle(
                  autoClosePSD,
                  changeAutoClosePSD,
                  locale.settingsAutoClosePsdLabel,
                  locale.settingsAutoClosePsdHint || "Closes the previous page's PSD when you move to another page"
                )}
              </div>
            </div>
            <div className="settings-group">
              <div className="settings-group-title">{locale.settingsGroupMultiTab || "Multi-series tabs"}</div>
              <div className="settings-checkbox-grid">
                {renderToggle(
                  multiTabEnabled,
                  changeMultiTabEnabled,
                  <React.Fragment>
                    {locale.settingsMultiTabLabel || "Multi-tab"}
                    <b className="settings-new-badge">{locale.settingsNewBadge || "New"}</b>
                  </React.Fragment>,
                  locale.settingsMultiTabHint || "Manage several series at once with tabs above the text block, each with its own text and PSD sync."
                )}
              </div>
            </div>
            <div className="settings-group">
              <div className="settings-group-title">{locale.settingsGroupTextDirection || "Text direction"}</div>
              <div className="field">
                <div className="field-label">{locale.settingsDirectionLabel}</div>
                <div className="field-input">
                  <select value={direction} onChange={changeDirection} className="topcoat-textarea">
                    <option value="ltr">{locale.settingsDirectionLtr}</option>
                    <option value="rtl">{locale.settingsDirectionRtl}</option>
                  </select>
                </div>
              </div>
              <div className="settings-checkbox-grid">
                {renderToggle(middleEast, changeMiddleEast, locale.settingsMiddleEastLabel, null)}
              </div>
            </div>
          </div>
        );

      case "styles":
        return (
          <div className="fields">
            <div className="settings-group">
              <div className="settings-group-title">{locale.settingsGroupStyleSelection || "Automatic selection"}</div>
              <div className="field">
                <div className="field-label">{locale.settingsDefaultStyleLabel}</div>
                <div className="field-input">
                  <select value={defaultStyleId} onChange={changeDefaultStyle} className="topcoat-textarea">
                    <option key="none" value="">
                      {locale.settingsDefaultStyleNone}
                    </option>
                    {context.state.styles.map((style) => (
                      <option key={style.id} value={style.id}>
                        {style.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-descr">{locale.settingsDefaultStyleDescr}</div>
              </div>
              <div className="settings-checkbox-grid">
                {renderToggle(
                  currentFolderTagPriority,
                  changeCurrentFolderTagPriority,
                  locale.settingsCurrentFolderTagPriorityLabel,
                  locale.settingsCurrentFolderTagPriorityHint ||
                    "Prevents script tags from selecting a style from another folder"
                )}
                {renderToggle(
                  autoScrollStyle,
                  changeAutoScrollStyle,
                  locale.settingsAutoScrollStyleLabel,
                  locale.settingsAutoScrollStyleHint || "Automatically scrolls to selected style"
                )}
              </div>
            </div>
            <div className="settings-group">
              <div className="settings-group-title">{locale.settingsGroupQuickSizes || "Quick sizes"}</div>
              <div className="settings-checkbox-grid">
                {renderToggle(
                  showQuickStyleSize,
                  changeShowQuickStyleSize,
                  locale.settingsQuickStyleSizeLabel || "Show style size presets",
                  locale.settingsQuickStyleSizeHint || "Display the clickable size presets on each style.",
                  <div className="field">
                    <div className="field-label">{locale.settingsQuickStyleSizeStepLabel || "Quick size step"}</div>
                    <div className="field-input">
                      <input
                        type="number"
                        min="0.01"
                        step="any"
                        value={styleSizeStep}
                        onChange={changeStyleSizeStep}
                        onBlur={resetStyleSizeStep}
                        className="topcoat-text-input--large"
                      />
                    </div>
                    <div className="field-descr">
                      {locale.settingsQuickStyleSizeStepHint || "Sets the increment used when editing size presets."}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="settings-group">
              <div className="settings-group-title">{locale.settingsRefontTitle || "Conditional refont"}</div>
              <div className="field-descr">
                {locale.settingsRefontHelp || "Text between two markers takes the font of another style (the size is kept). Example: quoted passages in italics."}
              </div>
              {refontRules.length > 0 && (
                <div className="settings-refont-list">
                  {refontRules.map((rule, index) => {
                    const styles = context.state.styles || [];
                    const styleValue = rule.styleId === null || rule.styleId === undefined ? "" : String(rule.styleId);
                    const hasStyle = styles.some((style) => String(style.id) === styleValue);
                    return (
                      <div className="settings-refont-row" key={index}>
                        <input
                          type="text"
                          maxLength={REFONT_MARKER_MAX_LENGTH}
                          value={rule.open}
                          onChange={(e) => updateRefontRule(index, { open: e.target.value })}
                          className={"topcoat-text-input settings-refont-marker" + (rule.open ? "" : " is-invalid")}
                          title={locale.settingsRefontOpen || "Opening marker"}
                          aria-label={locale.settingsRefontOpen || "Opening marker"}
                        />
                        <span className="settings-refont-between" aria-hidden="true">…</span>
                        <input
                          type="text"
                          maxLength={REFONT_MARKER_MAX_LENGTH}
                          value={rule.close}
                          onChange={(e) => updateRefontRule(index, { close: e.target.value })}
                          className={"topcoat-text-input settings-refont-marker" + (rule.close ? "" : " is-invalid")}
                          title={locale.settingsRefontClose || "Closing marker"}
                          aria-label={locale.settingsRefontClose || "Closing marker"}
                        />
                        <select
                          value={hasStyle ? styleValue : ""}
                          onChange={(e) => changeRefontRuleStyle(index, e.target.value)}
                          className="topcoat-textarea settings-refont-style"
                          title={locale.settingsRefontStyle || "Font taken from"}
                          aria-label={locale.settingsRefontStyle || "Font taken from"}
                        >
                          {!hasStyle && <option value="">—</option>}
                          {styles.map((style) => (
                            <option key={style.id} value={String(style.id)}>
                              {style.name}
                            </option>
                          ))}
                        </select>
                        <label className="settings-checkbox-label settings-refont-keep">
                          <input
                            type="checkbox"
                            checked={rule.keepMarkers === true}
                            onChange={(e) => updateRefontRule(index, { keepMarkers: e.target.checked })}
                          />
                          <div className="settings-checkbox-custom"></div>
                          <span>{locale.settingsRefontKeepMarkers || "Keep markers"}</span>
                        </label>
                        <button
                          type="button"
                          className="topcoat-icon-button--quiet settings-refont-remove"
                          onClick={() => removeRefontRule(index)}
                          title={locale.settingsRefontRemove || "Remove rule"}
                          aria-label={locale.settingsRefontRemove || "Remove rule"}
                        >
                          <FiTrash2 size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              <button
                type="button"
                className="topcoat-button settings-refont-add"
                onClick={addRefontRule}
                disabled={refontRules.length >= MAX_REFONT_RULES}
              >
                <FiPlus size={13} /> {locale.settingsRefontAdd || "Add rule"}
              </button>
            </div>
          </div>
        );

      case "data":
        return (
          <React.Fragment>
            <ProfileSettings
              currentLanguage={context.state.language}
              hasUnsavedChanges={edited}
            />
            <div className="fields">
              <div className="settings-group">
                <div className="settings-group-title">{locale.settingsGroupImportExport || "Import/Export"}</div>
                <FontScanPromo />
                <div className="field">
                  <button type="button" className="topcoat-button--large" onClick={importSettings}>
                    <FaFileImport size={18} /> {locale.settingsImport}
                  </button>
                </div>
                <div className="field">
                  <button type="button" className="topcoat-button--large" data-tour="export-settings" onClick={exportSettings}>
                    <FaFileExport size={18} /> {locale.settingsExport}
                  </button>
                </div>
              </div>
              <div className="settings-group">
                <div className="settings-group-title">{locale.settingsGroupDanger || "Danger zone"}</div>
                <div className="field">
                  <button type="button" className="topcoat-button--large settings-danger-btn" onClick={resetStorage}>
                    {locale.settingsResetProfile}
                  </button>
                </div>
                <div className="field-descr">
                  {locale.settingsResetProfileHint}
                </div>
              </div>
            </div>
          </React.Fragment>
        );

      case "appearance": {
        const vis = uiLayout.visible;
        const isShown = (key) => vis[key] !== false;
        const blockLabels = {
          preview: locale.settingsLayoutBlockPreview || "Preview & actions",
          text: locale.settingsLayoutBlockText || "Text",
          styles: locale.settingsLayoutBlockStyles || "Styles",
          footer: locale.settingsLayoutBlockFooter || "Footer",
        };
        const elementLabels = FOOTER_MODE_IDS.reduce((labels, id) => {
          labels[FOOTER_MODE_KEYS[id]] = footerModeLabel(id);
          return labels;
        }, {
          tabBar: locale.settingsLayoutElTabBar || "Tab bar",
          previewCreateButton: locale.settingsLayoutElCreate || "Create layer button",
          previewAlignButton: locale.settingsLayoutElAlign || "Align button",
          previewSizeControls: locale.settingsLayoutElSize || "Text size controls",
          previewNav: locale.settingsLayoutElNav || "Line navigation arrows",
          previewWidget: locale.settingsLayoutElWidget || "Line preview / TextShapeR",
          footerHelp: locale.settingsLayoutElHelp || "Help button",
          footerRepo: locale.settingsLayoutElRepo || "Import pages button",
        });
        // Mode states after "Save", like the toggles in the other tabs
        const modeStates = {
          textShapeR: { on: inlineTextShapeR },
          multiBubble: { on: multiBubbleMode },
          autoCenter: { on: autoCenterMode !== "off", multi: autoCenterMode === "multi" },
          pasteOnClick: { on: pasteOnClick },
          autoClean: { on: smartPasteAutoClean },
        };
        const onText = locale.multiBubbleModeOn || "ON";
        const offText = locale.multiBubbleModeOff || "OFF";
        const showText = locale.settingsLayoutShow || "Show";
        const hideText = locale.settingsLayoutHide || "Hide";
        const modeKeys = FOOTER_MODE_IDS.map((id) => FOOTER_MODE_KEYS[id]);
        const hiddenCount = (block) => LAYOUT_BLOCK_ELEMENTS[block].filter((key) => !isShown(key)).length;
        const previewMockHeight = Math.max(30, Math.round((parseInt(previewHeight, 10) || 130) * LAYOUT_CANVAS_SCALE));
        const stylesMockHeight = Math.max(14, Math.round((parseInt(stylesHeight, 10) || 70) * LAYOUT_CANVAS_SCALE));
        const visibleOrder = uiLayout.order.filter((id) => vis[id]);
        const lastVisibleBlock = visibleOrder[visibleOrder.length - 1];
        const hl = (key) => (layoutHoverEl === key ? " m-hl" : "");
        const stopMouse = (e) => e.stopPropagation();
        // A hidden element stays in the mockup, outlined: one click brings it back
        const mockEl = (key, className, children, extraClass = "") => (
          <span
            key={key}
            className={className + (isShown(key) ? "" : " m-off") + extraClass + hl(key)}
            onMouseDown={stopMouse}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedLayoutBlock(LAYOUT_ELEMENT_BLOCK[key]);
              toggleUiElement(key);
            }}
            onMouseEnter={() => setLayoutHoverEl(key)}
            onMouseLeave={() => setLayoutHoverEl(null)}
            title={elementLabels[key] + " – " + (isShown(key) ? hideText : showText)}
          >
            {children}
          </span>
        );
        const mockIcon = (key) => {
          const Icon = LAYOUT_ELEMENT_ICONS[key];
          return <Icon size={7} />;
        };
        const mockContents = {
          preview: (
            <div className="settings-layout-mock-inner">
              <div className="settings-layout-mock-row">
                {mockEl("previewCreateButton", "mk-pill mk-cta", mockIcon("previewCreateButton"))}
                {mockEl("previewAlignButton", "mk-pill", mockIcon("previewAlignButton"))}
                {mockEl("previewSizeControls", "mk-pill mk-small", mockIcon("previewSizeControls"))}
              </div>
              <div className="settings-layout-mock-row">
                {mockEl("previewNav", "mk-nav", mockIcon("previewNav"))}
                {mockEl("previewWidget", "mk-widget", mockIcon("previewWidget"))}
              </div>
            </div>
          ),
          text: (
            <div className="settings-layout-mock-inner m-top">
              {mockEl("tabBar", "settings-layout-mock-tabs", (
                <React.Fragment>
                  <span className="m-active-tab" />
                  <span />
                </React.Fragment>
              ))}
              <div className="settings-layout-mock-lines">
                <span style={{ width: "82%" }} />
                <span style={{ width: "58%" }} />
                <span style={{ width: "70%" }} />
              </div>
              <span className="settings-layout-mock-label">{blockLabels.text}</span>
            </div>
          ),
          styles: (
            <div className="settings-layout-mock-inner">
              <span className="settings-layout-mock-label">{blockLabels.styles}</span>
            </div>
          ),
        };
        const renderMockBlock = (id) => {
          const hidden = !vis[id];
          const style = {};
          if (!hidden) {
            if (id === "preview") style.height = previewMockHeight;
            if (id === "styles") {
              if (vis.text) style.height = stylesMockHeight;
              else style.flex = "1 1 auto";
            }
          }
          const resizable = !hidden && (id === "preview" || (id === "styles" && vis.text));
          // The resize handle sits on the edge facing the flexible text block
          const resizeDir = id === lastVisibleBlock ? -1 : 1;
          return (
            <div
              key={id}
              data-layout-block={id}
              className={
                "settings-layout-mock m-" + id +
                (selectedLayoutBlock === id ? " m-selected" : "") +
                (hidden ? " m-ghost" : "") +
                (layoutDrag === id ? " m-dragging" : "")
              }
              style={style}
              onMouseDown={(e) => startLayoutMove(e, id)}
            >
              {hidden ? (
                <div className="settings-layout-mock-ghost-row">
                  <FiEyeOff size={9} />
                  <span>{blockLabels[id]}</span>
                </div>
              ) : (
                mockContents[id]
              )}
              <button
                type="button"
                className="settings-layout-mock-eye"
                title={hidden ? showText : hideText}
                onMouseDown={stopMouse}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedLayoutBlock(id);
                  toggleUiElement(id);
                }}
              >
                {hidden ? <FiEye size={10} /> : <FiEyeOff size={10} />}
              </button>
              {resizable && (
                <div
                  className={"settings-layout-mock-resize" + (resizeDir === -1 ? " m-top" : "")}
                  title={id === "preview"
                    ? (locale.settingsLayoutPreviewHeight || "Preview height (px)")
                    : (locale.settingsLayoutStylesHeight || "Styles height (px)")}
                  onMouseDown={(e) => startLayoutResize(e, id, resizeDir)}
                />
              )}
            </div>
          );
        };
        const renderHeightSlider = (value, setter, min, max, fallback) => (
          <div className="settings-layout-slider">
            <div className="settings-layout-slider-head">
              <span>{locale.settingsLayoutHeight || "Height (px)"}</span>
              <input type="number" min={min} max={max} value={value} onChange={changeUiSize(setter)} className="topcoat-text-input--large" />
            </div>
            <input
              type="range"
              min={min}
              max={max}
              value={Math.min(max, Math.max(min, parseInt(value, 10) || fallback))}
              onChange={(e) => {
                setter(e.target.value);
                setEdited(true);
              }}
            />
          </div>
        );
        const renderElementRow = (key, { extra = null, note = null } = {}) => {
          const Icon = LAYOUT_ELEMENT_ICONS[key];
          const shown = isShown(key);
          return (
            <label
              key={key}
              className={"settings-layout-element" + (shown ? "" : " m-off") + hl(key)}
              onMouseEnter={() => setLayoutHoverEl(key)}
              onMouseLeave={() => setLayoutHoverEl(null)}
            >
              <Icon size={13} className="settings-layout-element-icon" />
              <span className="settings-layout-element-text">
                <span className="settings-layout-element-label">{elementLabels[key]}</span>
                {note && <span className="settings-layout-element-note">{note}</span>}
              </span>
              {extra}
              <LayoutSwitch checked={shown} onChange={() => toggleUiElement(key)} title={shown ? hideText : showText} />
            </label>
          );
        };
        const renderModeRow = (id) => {
          const state = modeStates[id];
          return renderElementRow(FOOTER_MODE_KEYS[id], {
            note: id === "autoClean" && !smartPaste
              ? (locale.settingsLayoutAutoCleanNote || "Only shown while smart paste is on.")
              : null,
            extra: (
              <span
                className={"settings-layout-mode-state" + (state.on ? " m-on" : "") + (state.multi ? " m-multi" : "")}
                title={locale.settingsLayoutModeState || "Current state of the mode"}
              >
                <i />
                {state.multi ? (locale.autoCenterModeMulti || "MULTI") : state.on ? onText : offText}
              </span>
            ),
          });
        };
        const allModesShown = modeKeys.every(isShown);
        const selectedIsPanel = selectedLayoutBlock !== "footer";
        const selectedVisible = selectedIsPanel ? vis[selectedLayoutBlock] !== false : true;
        const selectedIndex = uiLayout.order.indexOf(selectedLayoutBlock);
        const selectedElements = LAYOUT_BLOCK_ELEMENTS[selectedLayoutBlock] || [];
        const SelectedIcon = LAYOUT_BLOCK_ICONS[selectedLayoutBlock];
        const scaleValue = Math.min(150, Math.max(70, parseInt(uiScale, 10) || 100));
        return (
          <div className="fields">
            <div className="settings-group">
              <div className="settings-group-title">{locale.settingsGroupTheme || "Theme"}</div>
              <div className="settings-theme-grid">
                {themeList.map((theme) => {
                  const preview = getEditorThemePreviewColors(theme);
                  const isActive = editorTheme === theme.id;
                  const isImage = theme.id === CUSTOM_IMAGE_THEME_ID;
                  const label = isImage
                    ? locale.settingsThemeImage || "Custom image"
                    : theme.labelKey
                      ? locale[theme.labelKey]
                      : theme.label || (locale.settingsThemeUntitled || "Custom theme");
                  const editable = isImage || theme.custom;
                  return (
                    <div className="settings-theme-cell" key={theme.id}>
                      <button
                        type="button"
                        className={"settings-theme-choice" + (isActive ? " m-active" : "")}
                        onClick={() => changeEditorTheme(theme.id)}
                        title={label}
                        style={{ "--theme-card-accent": preview.accent }}
                      >
                        <span
                          className="settings-theme-preview"
                          style={
                            isImage && backgroundData
                              ? { backgroundColor: preview.surface, backgroundImage: `url("${backgroundData}")` }
                              : { backgroundColor: preview.surface }
                          }
                        >
                          <span className="settings-theme-preview-bar" style={{ backgroundColor: preview.panel }}>
                            <i style={{ backgroundColor: preview.accent }} />
                            <i style={{ backgroundColor: preview.muted }} />
                          </span>
                          <span className="settings-theme-preview-line m-long" style={{ backgroundColor: preview.text }} />
                          <span className="settings-theme-preview-line" style={{ backgroundColor: preview.muted }} />
                          <span className="settings-theme-preview-pill" style={{ backgroundColor: preview.accent }} />
                          {isActive && (
                            <span
                              className="settings-theme-check"
                              style={{ backgroundColor: preview.accent, color: preview.accentText || preview.surface }}
                            >
                              <FiCheck size={10} />
                            </span>
                          )}
                        </span>
                        <span className="settings-theme-name">{label}</span>
                      </button>
                      {editable && (
                        <div className="settings-theme-tools">
                          <button
                            type="button"
                            className={
                              "settings-theme-tool" +
                              ((isImage ? backgroundEditorOpen : editedThemeId === theme.id) ? " m-active" : "")
                            }
                            title={locale.settingsThemeEdit || "Customize"}
                            onClick={() => (isImage ? openBackgroundEditor() : openThemeEditor(theme.id))}
                          >
                            <FiEdit2 size={11} />
                          </button>
                          <button
                            type="button"
                            className="settings-theme-tool m-danger"
                            title={locale.delete || "Delete"}
                            onClick={() => (isImage ? removeBackgroundImage() : askDeleteCustomTheme(theme.id))}
                          >
                            <FiTrash2 size={11} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="settings-theme-cell">
                  <button
                    type="button"
                    className="settings-theme-choice m-add"
                    onClick={createCustomTheme}
                    title={locale.settingsThemeNew || "New theme"}
                  >
                    <span className="settings-theme-preview m-add">
                      <FiPlus size={20} />
                    </span>
                    <span className="settings-theme-name">{locale.settingsThemeNew || "New theme"}</span>
                  </button>
                </div>
                {!backgroundImage && (
                  <div className="settings-theme-cell">
                    <button
                      type="button"
                      className={"settings-theme-choice m-add" + (backgroundEditorOpen ? " m-active" : "")}
                      onClick={openBackgroundEditor}
                      title={locale.settingsThemeImage || "Custom image"}
                    >
                      <span className="settings-theme-preview m-add">
                        <FiImage size={20} />
                      </span>
                      <span className="settings-theme-name">{locale.settingsThemeImage || "Custom image"}</span>
                    </button>
                  </div>
                )}
              </div>
              {editedTheme && (
                <ThemeEditor
                  theme={editedTheme}
                  onChange={updateCustomTheme}
                  onClose={() => setEditedThemeId(null)}
                />
              )}
              {backgroundEditorOpen && (
                <BackgroundEditor
                  image={backgroundImage}
                  data={backgroundData}
                  busy={backgroundBusy}
                  onImport={importBackgroundImage}
                  onChange={updateBackgroundImage}
                  onRemove={removeBackgroundImage}
                  onClose={() => setBackgroundEditorOpen(false)}
                />
              )}
              <div className="settings-color-row">
                <ColorField
                  label={locale.settingsPageLineColor || "Page line background"}
                  value={pageLineColor}
                  onChange={changePageLineColor}
                  clearable={true}
                  onClear={() => changePageLineColor("")}
                />
                <span className="settings-color-hint">
                  {locale.settingsPageLineColorHint || "Background of the lines marked as a page separator."}
                </span>
              </div>
            </div>
            <div className="settings-group">
              <div className="settings-group-title">{locale.settingsGroupInterface || "Interface layout"}</div>
              <div className="settings-layout-picker">
                {uiLayout.order.concat(["footer"]).map((id) => {
                  const Icon = LAYOUT_BLOCK_ICONS[id];
                  const count = hiddenCount(id);
                  const blockHidden = id !== "footer" && !vis[id];
                  return (
                    <button
                      key={id}
                      type="button"
                      className={
                        "settings-layout-pick" +
                        (selectedLayoutBlock === id ? " m-active" : "") +
                        (blockHidden ? " m-hidden" : "")
                      }
                      title={blockLabels[id]}
                      onClick={() => setSelectedLayoutBlock(id)}
                    >
                      <Icon size={12} />
                      <span className="settings-layout-pick-label">{blockLabels[id]}</span>
                      {(blockHidden || count > 0) && (
                        <span
                          className="settings-layout-pick-badge"
                          title={blockHidden
                            ? (locale.settingsLayoutBlockHidden || "Panel hidden")
                            : (locale.settingsLayoutHiddenCount || "{count} hidden").replace("{count}", count)}
                        >
                          <FiEyeOff size={8} />
                          {!blockHidden && count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="settings-layout">
                <div className="settings-layout-canvas-wrap">
                  <div
                    ref={layoutCanvasRef}
                    className={"settings-layout-canvas" + (layoutDrag ? (layoutDrag === "resize" ? " m-resizing" : " m-moving") : "")}
                  >
                    {uiLayout.order.map(renderMockBlock)}
                    <div
                      className={"settings-layout-mock-footerbar" + (selectedLayoutBlock === "footer" ? " m-selected" : "")}
                      title={blockLabels.footer}
                      onClick={() => setSelectedLayoutBlock("footer")}
                    >
                      {mockEl("footerHelp", "mk-f", mockIcon("footerHelp"))}
                      <span className="mk-f m-fixed" title={locale.settingsLayoutElSettings || "Settings button"}>
                        <FiSettings size={7} />
                      </span>
                      {mockEl("footerRepo", "mk-f", mockIcon("footerRepo"))}
                      <span className="mk-fspacer" />
                      {FOOTER_MODE_IDS.map((id) => mockEl(
                        FOOTER_MODE_KEYS[id],
                        "mk-fmode",
                        (
                          <React.Fragment>
                            <i className={"mk-fdot" + (modeStates[id].on ? " m-on" : "") + (modeStates[id].multi ? " m-multi" : "")} />
                            {mockIcon(FOOTER_MODE_KEYS[id])}
                          </React.Fragment>
                        ),
                        id === "autoClean" && !smartPaste ? " m-na" : ""
                      ))}
                    </div>
                  </div>
                </div>
                <div className="settings-layout-inspector">
                  <div className="settings-layout-inspector-head">
                    <SelectedIcon size={14} className="settings-layout-inspector-icon" />
                    <span className={"settings-layout-inspector-title" + (selectedVisible ? "" : " m-hidden")}>
                      {blockLabels[selectedLayoutBlock]}
                    </span>
                    {selectedIsPanel && (
                      <div className="settings-layout-inspector-tools">
                        <button
                          type="button"
                          className="settings-layout-icon-btn"
                          disabled={selectedIndex <= 0}
                          title={locale.settingsLayoutMoveUp || "Move up"}
                          onClick={() => moveUiBlock(selectedLayoutBlock, -1)}
                        >
                          <FiChevronUp size={13} />
                        </button>
                        <button
                          type="button"
                          className="settings-layout-icon-btn"
                          disabled={selectedIndex === uiLayout.order.length - 1}
                          title={locale.settingsLayoutMoveDown || "Move down"}
                          onClick={() => moveUiBlock(selectedLayoutBlock, 1)}
                        >
                          <FiChevronDown size={13} />
                        </button>
                        <LayoutSwitch
                          checked={selectedVisible}
                          onChange={() => toggleUiElement(selectedLayoutBlock)}
                          title={selectedVisible ? hideText : showText}
                        />
                      </div>
                    )}
                  </div>
                  {selectedIsPanel && !selectedVisible && (
                    <div className="settings-layout-inspector-note">
                      {locale.settingsLayoutBlockHiddenNote || "This panel is hidden. Turn it back on with the switch above."}
                    </div>
                  )}
                  {selectedVisible && selectedLayoutBlock === "preview" && renderHeightSlider(previewHeight, setPreviewHeight, 80, 300, defaultUiLayout.sizes.previewHeight)}
                  {selectedVisible && selectedLayoutBlock === "styles" && (vis.text
                    ? renderHeightSlider(stylesHeight, setStylesHeight, 70, 500, 70)
                    : (
                      <div className="settings-layout-inspector-note">
                        {locale.settingsLayoutTextAuto || "Fills the remaining space automatically."}
                      </div>
                    ))}
                  {selectedVisible && selectedLayoutBlock === "text" && (
                    <div className="settings-layout-inspector-note">
                      {locale.settingsLayoutTextAuto || "Fills the remaining space automatically."}
                    </div>
                  )}
                  {selectedLayoutBlock === "footer" ? (
                    <React.Fragment>
                      <div className="settings-layout-subtitle">
                        <span>{locale.settingsLayoutGroupButtons || "Buttons"}</span>
                      </div>
                      <div className="settings-layout-elements">
                        {renderElementRow("footerHelp")}
                        <div className="settings-layout-element m-locked">
                          <FiSettings size={13} className="settings-layout-element-icon" />
                          <span className="settings-layout-element-text">
                            <span className="settings-layout-element-label">{locale.settingsLayoutElSettings || "Settings button"}</span>
                          </span>
                          <span className="settings-layout-locked">
                            <FiLock size={10} /> {locale.settingsLayoutAlwaysShown || "Always shown"}
                          </span>
                        </div>
                        {renderElementRow("footerRepo")}
                      </div>
                      <div className="settings-layout-subtitle">
                        <span>{locale.settingsLayoutGroupModes || "Mode toggles"}</span>
                        <button
                          type="button"
                          className="settings-layout-link"
                          onClick={() => setUiElements(modeKeys, !allModesShown)}
                        >
                          {allModesShown
                            ? (locale.settingsLayoutHideAll || "Hide all")
                            : (locale.settingsLayoutShowAll || "Show all")}
                        </button>
                      </div>
                      <div className="settings-layout-elements">
                        {FOOTER_MODE_IDS.map(renderModeRow)}
                      </div>
                      <div className="settings-layout-inspector-note">
                        {locale.settingsLayoutModeKeepsState || "A hidden toggle keeps its current state, and its shortcut still works."}
                      </div>
                    </React.Fragment>
                  ) : selectedElements.length > 0 && (
                    <div className={"settings-layout-elements" + (selectedVisible ? "" : " m-disabled")}>
                      {selectedElements.map((key) => renderElementRow(key))}
                    </div>
                  )}
                </div>
              </div>
              <div className="settings-layout-scale">
                <span className="settings-layout-scale-label">
                  <FiZoomIn size={13} />
                  {locale.settingsLayoutScaleLabel || "Interface scale"}
                </span>
                <input
                  type="range"
                  min="70"
                  max="150"
                  step="5"
                  value={scaleValue}
                  onChange={(e) => {
                    setUiScale(e.target.value);
                    setEdited(true);
                  }}
                />
                <span className="settings-layout-scale-value">{scaleValue}%</span>
                <button
                  type="button"
                  className="settings-layout-icon-btn"
                  disabled={scaleValue === defaultUiLayout.sizes.uiScale}
                  title={(locale.settingsLayoutScaleReset || "Back to {scale}%").replace("{scale}", defaultUiLayout.sizes.uiScale)}
                  onClick={() => {
                    setUiScale(String(defaultUiLayout.sizes.uiScale));
                    setEdited(true);
                  }}
                >
                  <FiRotateCcw size={11} />
                </button>
              </div>
              <div className="field-descr">
                {locale.settingsLayoutCanvasHint || "Click an element in the preview to show or hide it: hidden ones stay outlined. Drag panels to reorder them, or drag their edge to resize."}
              </div>
              <div className="field">
                <button type="button" className="topcoat-button--large" onClick={resetUiLayout}>
                  <FiRotateCcw size={14} /> {locale.settingsLayoutReset || "Reset layout"}
                </button>
              </div>
            </div>
          </div>
        );
      }

      case "shortcuts":
        return (
          <div className="fields">
            <div className="settings-group">
              <div className="field-descr">
                {locale.settingsShortcutsHint || "Click a shortcut and press the new key combination."}
              </div>
            </div>
            {shortcutGroups.map((group) => (
              <div className="settings-group" key={group.id}>
                <div className="settings-group-title">{group.label}</div>
                <div className="shortcut-list">
                  {group.commands.map((command) => (
                    <Shortcut
                      key={command.id}
                      value={shortcutDraft[command.id] || []}
                      index={command.id}
                      modifierOnly={command.modifierOnly === true}
                      onChange={changeShortcut}
                      conflict={shortcutConflicts[command.id]
                        ? (locale.shortcutConflict || "Also assigned to: {actions}")
                          .replace("{actions}", shortcutConflicts[command.id])
                        : shortcutModifierOverlaps[command.id]
                          ? (locale.shortcutModifierOverlap || "Always combined with: {actions}")
                            .replace("{actions}", shortcutModifierOverlaps[command.id])
                          : ""}
                    />
                  ))}
                </div>
              </div>
            ))}
            <div className="settings-group">
              <div className="field">
                <button type="button" className="topcoat-button--large" onClick={resetShortcuts}>
                  <FiRotateCcw size={14} /> {locale.settingsResetShortcuts || "Reset shortcuts"}
                </button>
              </div>
              <div className="field-descr">
                {locale.settingsShortcutsTip || "If shortcuts feel buggy or stop working, resetting them often fixes it."}
              </div>
            </div>
          </div>
        );

      case "fontViewer":
        return <FontViewer />;

      default:
        return null;
    }
  };

  return (
    <React.Fragment>
      <div className="app-modal-header hostBrdBotContrast">
        <div className="app-modal-title">{locale.settingsTitle}</div>
        <button className="topcoat-icon-button--large--quiet" title={locale.close} onClick={close}>
          <FiX size={18} />
        </button>
      </div>
      <div className="app-modal-body">
        <div className="app-modal-body-inner">
          <div className="settings-tabs">
            {tabs.map((tab) => {
              const IconComponent = tab.icon;
              return (
                <button
                  key={tab.id}
                  className={`settings-tab ${activeTab === tab.id ? 'settings-tab--active' : ''}${tab.disabled ? ' settings-tab--disabled' : ''}`}
                  data-tour={"settings-" + tab.id}
                  aria-disabled={tab.disabled || undefined}
                  title={tab.disabled ? tab.disabledTitle : tab.label}
                  onClick={() => {
                    if (!tab.disabled) setActiveTab(tab.id);
                  }}
                >
                  <IconComponent size={16} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
          <form
            className={`settings-content${activeTab === "fontViewer" ? " settings-content--font-viewer" : ""}`}
            onSubmit={activeTab === "fontViewer" ? (event) => event.preventDefault() : save}
          >
            {renderTabContent()}
            {activeTab !== "fontViewer" && <div className="settings-actions hostBgdLight hostBrdTopContrast">
              {edited && (
                <span className="settings-unsaved">
                  {locale.settingsUnsavedChanges || "Unsaved changes"}
                </span>
              )}
              <button type="submit" className={edited ? "topcoat-button--large--cta" : "topcoat-button--large"}>
                <MdSave size={18} /> {locale.save}
              </button>
            </div>}
          </form>
        </div>
        {themeToDelete && (
          // In-panel dialog: a Photoshop modal opened on top of the settings
          // modal is dismissed along with it and never returns an answer.
          <div className="settings-confirm-overlay" onClick={() => setConfirmDeleteThemeId(null)}>
            <div className="settings-confirm-dialog hostBgdLight" onClick={(e) => e.stopPropagation()}>
              <div className="settings-confirm-icon">
                <FiAlertTriangle size={26} />
              </div>
              <div className="settings-confirm-title">
                {locale.settingsThemeDelete || "Delete theme"}
              </div>
              <div className="settings-confirm-text">
                {(locale.settingsThemeDeleteConfirm || 'Are you sure you want to delete "{name}"?')
                  .replace("{name}", themeToDelete.label || (locale.settingsThemeUntitled || "Custom theme"))}
              </div>
              <div className="settings-confirm-actions">
                <button type="button" className="topcoat-button--large" onClick={() => setConfirmDeleteThemeId(null)}>
                  {locale.no || "No"}
                </button>
                <button
                  type="button"
                  className="topcoat-button--large--cta settings-confirm-danger"
                  onClick={() => deleteCustomTheme(themeToDelete.id)}
                >
                  {locale.yes || "Yes"}
                </button>
              </div>
            </div>
          </div>
        )}
        {multiTabConfirmOpen && (
          <div className="settings-confirm-overlay" onClick={cancelDisableMultiTab}>
            <div className="settings-confirm-dialog hostBgdLight" onClick={(e) => e.stopPropagation()}>
              <div className="settings-confirm-icon">
                <FiAlertTriangle size={26} />
              </div>
              <div className="settings-confirm-title">
                {locale.settingsMultiTabDisableTitle || "Disable multi-tab?"}
              </div>
              <div className="settings-confirm-text">
                {(locale.settingsMultiTabDisableConfirm || 'All tabs other than "{name}" will be lost.')
                  .replace("{name}", (context.state.tabs || [])[0]?.name || "")}
              </div>
              <div className="settings-confirm-actions">
                <button type="button" className="topcoat-button--large" onClick={cancelDisableMultiTab}>
                  {locale.cancel || "Cancel"}
                </button>
                <button type="button" className="topcoat-button--large--cta settings-confirm-danger" onClick={confirmDisableMultiTab}>
                  {locale.settingsMultiTabDisableAction || "Disable"}
                </button>
              </div>
            </div>
          </div>
        )}
        {missingFontsImport && (
          <MissingFontsDialog
            fonts={missingFontsImport.fonts}
            message={missingFontsImport.message}
            onClose={() => setMissingFontsImport(null)}
          />
        )}
        {discardConfirmOpen && (
          <UnsavedChangesDialog
            onConfirm={confirmClose}
            onCancel={() => setDiscardConfirmOpen(false)}
          />
        )}
      </div>
    </React.Fragment>
  );
});

export default SettingsModal;
