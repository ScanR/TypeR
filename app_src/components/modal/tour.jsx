// The guided tours: a floating guide that leads the user through hands-on
// exercises on a practice page in Photoshop. Each step is checked from the
// panel state and passes by itself when the user does it; the guide never
// does the gesture, it rings the real control (whatsNewSpotlight.js).
//
// A course (walkthrough.jsx, whatsNew.jsx) gives the chapters and the
// texts of the intro, end and resume screens; this engine runs them, keeps
// the progress (whatsNewSession.js) and places the guide (whatsNewGuide.js).

import React from "react";
import {
  FiCheck,
  FiChevronDown,
  FiChevronLeft,
  FiChevronRight,
  FiChevronUp,
  FiClock,
  FiList,
  FiLock,
  FiPlayCircle,
  FiRotateCcw,
  FiSkipForward,
  FiX,
} from "react-icons/fi";
import { MdDragIndicator } from "react-icons/md";

import { useContext } from "../../context";
import { useModalClose } from "../../modalClose";
import { pasteInSelection, nextAutoCenterMode, shortcutKeyLabels } from "../../shortcutCommands";
import { alignTextLayerToSelection, locale, openFile, scrollToLine } from "../../utils";
import {
  buildPracticeScript,
  endWhatsNewSession,
  findPracticeLineIndex,
  backupTourTuning,
  getPracticePagePath,
  restoreTourTuning,
  resumeWhatsNewSession,
  saveWhatsNewProgress,
  startWhatsNewSession,
  whatsNewSession as session,
} from "../../whatsNewSession";
import { keepGuideInside, startGuideDrag } from "../../whatsNewGuide";
import { clearTourSpot, isTourSpotMissing, setTourSpot, setTourSpotListener } from "../../whatsNewSpotlight";
import { setTourEventListener, tourEventCount } from "../../tourEvents";

/* ============================ illustrations ============================ */

// Text lines drawn as rounded bars, centred on cx
export const Bars = ({ cx, rows, className }) => (
  <g className={className}>
    {rows.map(([y, width], index) => (
      <rect key={index} className={`whats-new-bar m-row${index + 1}`} x={cx - width / 2} y={y + 1} width={width} height={4.5} rx={2.25} />
    ))}
  </g>
);


/* ============================== helpers =============================== */

export const fill = (text, values) => Object.keys(values).reduce((out, key) => out.split("{" + key + "}").join(values[key]), text);

// 1.5 -> "1 min 30", 0.5 -> "30 s"
export const formatMinutes = (minutes) => {
  const whole = Math.floor(minutes);
  const seconds = Math.round((minutes - whole) * 60);
  if (!whole) return fill(locale.whatsNewTimeSeconds || "{count} s", { count: seconds });
  if (!seconds) return fill(locale.whatsNewTimeMinutes || "{count} min", { count: whole });
  return fill(locale.whatsNewTimeMinutesSeconds || "{minutes} min {seconds}", { minutes: whole, seconds });
};

export const isUxp = () => typeof window !== "undefined" && !!window.typerUXP;
const hasKeys = (keys) => Array.isArray(keys) ? keys.length > 0 : !!keys;

/* ========================= spotlight candidates ========================= */

// Spotlight candidates (whatsNewSpotlight.js): the real controls carry a
// data-tour attribute
export const tour = (name) => ({ selector: `[data-tour="${name}"]` });
export const unlessActive = (tabId) => ({ selector: `[data-tour="settings-${tabId}"]:not(.settings-tab--active)` });
export const byId = (id) => `[id=${JSON.stringify(String(id))}]`;
export const styleItem = (id) => (id ? { selector: `.style-item${byId(id)}` } : null);
export const stylePencil = (id) => (id ? { selector: `.style-item${byId(id)} [data-tour="edit-style"]` } : null);
export const tabOf = (id) => (id ? { selector: `[data-tour-tab=${JSON.stringify(String(id))}]` } : null);
export const activeSettingsTab = (tabId) => `.settings-tab--active[data-tour="settings-${tabId}"]`;

/* ============================== steps ================================ */

const textOf = (value, env) => (typeof value === "function" ? value(env) : value);

// A setting already there when the run began (an earlier run, the user's
// own setup) does not pass its step: the user has to change it in this run.
// `fresh` reads the value; the start value is dropped once it changes.
// Toggle steps (`preset`) are lighter: see the preset effect in the modal.
const takeStartValues = (chapters, env) => {
  const values = {};
  chapters.forEach((chapter) => chapter.steps.forEach((step) => {
    if (step.fresh && step.check(env)) values[step.id] = step.fresh(env);
  }));
  return values;
};

const heldOver = (step, env) => {
  const values = session.startValues;
  if (!step.fresh || !values || !Object.prototype.hasOwnProperty.call(values, step.id)) return false;
  if (step.check(env) && step.fresh(env) === values[step.id]) return true;
  delete values[step.id];
  return false;
};

const stepState = (step, env) => {
  const record = session.done[step.id];
  if (record === "skipped") return "skipped";
  if (record) return "done";
  // Passes only while it is the current step (preset effect)
  if (step.preset) return "todo";
  let passed;
  if (step.lines) passed = env.onPracticeTab && step.lines.every((number) => env.isPasted(number));
  else if (step.check) {
    // Read first: a value seen turned off must drop the start value
    const held = heldOver(step, env);
    passed = step.check(env) && !held;
  }
  else if (step.line) passed = env.onPracticeTab && env.isPasted(step.line);
  // A gesture that leaves no trace in the panel, made during the step
  if (step.event) passed = env.eventSince(step.id, step.event);
  return passed ? "done" : "todo";
};

// The line the next paste of a step must start from
const expectedLine = (step, env) => {
  if (step.lines) {
    for (let i = 0; i < step.lines.length; i++) if (!env.isPasted(step.lines[i])) return step.lines[i];
    return null;
  }
  return step.line || null;
};

const chapterComplete = (chapter, env) => chapter.steps.every((step) => stepState(step, env) !== "todo");

/* =============================== modal ================================ */

// course: { id (its modal type), getChapters, art, hero, title, practiceTabName,
// completeAction, extendEnv, intro, end }; see walkthrough.jsx and whatsNew.jsx
const TourModal = React.memo(function TourModal({ course }) {
  const context = useContext((state) => ({
    smartPaste: state.smartPaste,
    smartPasteDistribute: state.smartPasteDistribute,
    smartPasteAutoClean: state.smartPasteAutoClean,
    pasteOnClick: state.pasteOnClick,
    inlineTextShapeR: state.inlineTextShapeR,
    textShapeRAppliedThisSession: state.textShapeRAppliedThisSession,
    textShapeRLearnedThisSession: state.textShapeRLearnedThisSession,
    autoCenterMode: state.autoCenterMode,
    currentTabId: state.currentTabId,
    tabs: state.tabs,
    lines: state.lines,
    currentLineIndex: state.currentLineIndex,
    usedLineStyles: state.usedLineStyles,
    styles: state.styles,
    currentStyleId: state.currentStyleId,
    currentStyle: state.currentStyle,
    currentFolderTagPriority: state.currentFolderTagPriority,
    shortcut: state.shortcut,
    uiLayout: state.uiLayout,
  }));
  const { dispatch, getState } = context;
  const state = context.state;
  const chapters = React.useMemo(course.getChapters, []);
  if (!session.active || session.course !== course.id) startWhatsNewSession(chapters.length, course.id);
  const [, rerender] = React.useReducer((count) => count + 1, 0);
  const view = session.chapter;
  const chapter = view >= 1 && view <= chapters.length ? chapters[view - 1] : null;

  /* --------------------------- environment --------------------------- */

  const practiceTab = session.practiceTabId && (state.tabs || []).find((tab) => tab.id === session.practiceTabId);
  const onPracticeTab = !!practiceTab && state.currentTabId === session.practiceTabId;
  const lineIndex = (number) => (onPracticeTab ? findPracticeLineIndex(state.lines, number) : -1);
  const usedStyleId = (number) => {
    const index = lineIndex(number);
    const used = index >= 0 && state.usedLineStyles && state.usedLineStyles[index];
    return used ? used.styleId : null;
  };
  const currentStyle = state.currentStyleId && (state.styles || []).some((style) => style.id === state.currentStyleId)
    ? state.currentStyle
    : null;
  const folderOf = (style) => (style && style.folder) || null;
  // The style marked for a role in the current style's folder (smart paste
  // uses that one)
  const roleStyle = (role) => (state.styles || []).find((style) => style.bubbleType === role &&
    folderOf(style) === folderOf(currentStyle)) || null;
  const shoutStyle = roleStyle("shout");
  const narrationStyle = roleStyle("narration");
  const env = {
    state,
    onPracticeTab,
    practiceTab: !!practiceTab,
    lineIndex,
    isPasted: (number) => usedStyleId(number) !== null,
    usedStyleId,
    currentStyle,
    shoutStyle,
    narrationStyle,
    // Styles made since the step began (a step with `known`)
    newStyles: (stepId) => {
      const known = session.known[stepId];
      return known ? (state.styles || []).filter((style) => known.indexOf(style.id) === -1) : [];
    },
    eventSince: (stepId, name) => typeof session.eventStart[stepId] === "number" && tourEventCount(name) > session.eventStart[stepId],
  };
  if (course.extendEnv) course.extendEnv(env);

  /* --------------------------- current step --------------------------- */

  // What is already set when the run begins (or starts over) has to be done again
  if (!session.resumeOffer && !session.startValues) session.startValues = takeStartValues(chapters, env);

  const states = chapter ? chapter.steps.map((item) => stepState(item, env)) : [];
  const firstTodo = states.indexOf("todo");
  const focused = chapter ? session.focus[chapter.id] : undefined;
  const current = chapter ? (typeof focused === "number" ? focused : firstTodo) : -1;
  const step = current >= 0 ? chapter.steps[current] : null;
  const stepTodo = !!step && states[current] === "todo";

  const unmetNeeds = step
    ? (chapter.needs || []).concat(step.needs || []).filter((need) => (need.field === "smartPasteDistribute"
      ? state.smartPasteDistribute === false
      : state[need.field] !== true))
    : [];
  const footerNeed = unmetNeeds.find((need) => need.footer) || null;
  const settingNeeds = unmetNeeds.filter((need) => !need.footer);
  // The bubble line the next paste must start from, and what stands in the way
  const line = stepTodo ? expectedLine(step, env) : null;
  const lineProblem = !line
    ? null
    : !practiceTab ? "script" : !onPracticeTab ? "tab" : state.currentLineIndex !== lineIndex(line) ? "line" : null;
  const clickPastes = state.pasteOnClick === true;

  // The control the user has to use now, ringed in the panel
  const getSpot = () => {
    if (!stepTodo || settingNeeds.length) return null;
    if (footerNeed) return { key: step.id + ":need:" + footerNeed.field, candidates: [tour("mode-" + footerNeed.footer)] };
    if (lineProblem === "script") return null;
    if (lineProblem === "tab") return { key: step.id + ":tab", candidates: [tabOf(session.practiceTabId)] };
    if (lineProblem === "line") {
      const index = lineIndex(line);
      return {
        key: step.id + ":line:" + index,
        candidates: [{ selector: `.text-line[data-line-index="${index}"] .text-line-select` }],
        reveal: () => scrollToLine(index, 0),
      };
    }
    if (step.paste) return clickPastes ? null : { key: step.id + ":paste", candidates: [tour("paste")] };
    if (!step.spot && !step.visit) return null;
    const candidates = (step.spot ? step.spot(env) : []).filter(Boolean);
    const revealing = candidates.find((candidate) => candidate.reveal);
    return {
      key: step.id + ":" + candidates.map((candidate) => candidate.selector || "find").join("|"),
      candidates,
      marks: step.marks ? step.marks(env) : null,
      visit: step.visit,
      stepId: step.id,
      reveal: revealing ? revealing.reveal : undefined,
    };
  };
  const spot = getSpot();
  const spotKey = spot ? spot.key : null;
  const spotMissing = !!spot && isTourSpotMissing();

  // The tour goes in order: a chapter opens once every chapter before it is done
  const chapterOpen = (index) => chapters.slice(0, Math.max(0, index - 1)).every((item) => chapterComplete(item, env));

  // A chapter finished while it is on screen moves on to the next one right
  // away, before it is painted. A chapter opened again once done stays.
  // (session.shownChapter outlives the guide: a step finished in the
  // settings moves on once they close)
  const chapterDone = !!chapter && chapterComplete(chapter, env);
  React.useLayoutEffect(() => {
    const shown = session.shownChapter || {};
    session.shownChapter = { view, done: chapterDone };
    if (shown.view === view && !shown.done && chapterDone) goTo(view + 1);
  });

  /* ---------------------------- side effects ---------------------------- */

  // A toggle step already on when the guide gets to it shows the toggle for
  // a moment, then passes by itself; turned on by the user, it passes at once
  const presetOn = !!step && stepTodo && !!step.preset && step.check(env);
  React.useEffect(() => {
    if (!step || !stepTodo || !step.preset) return undefined;
    const pass = () => {
      session.done[step.id] = true;
      rerender();
    };
    if (!presetOn) {
      session.presetOff[step.id] = true;
      return undefined;
    }
    if (session.presetOff[step.id]) {
      pass();
      return undefined;
    }
    const timer = setTimeout(pass, 2000);
    return () => clearTimeout(timer);
  }, [step && step.id, stepTodo, presetOn]);

  // A step that passed stays done, even if the user undoes it afterwards
  React.useEffect(() => {
    chapters.forEach((item) => item.steps.forEach((entry) => {
      if (!session.done[entry.id] && stepState(entry, env) === "done") session.done[entry.id] = true;
    }));
  });

  // The ring follows the step; the window the step opens shows its tip
  React.useEffect(() => {
    setTourSpot(spot);
    session.coach = stepTodo && step.coach ? { stepId: step.id, modal: step.coachIn, text: textOf(step.coach, env) } : null;
  });

  React.useEffect(() => {
    setTourSpotListener({
      onMissing: () => rerender(),
      onChange: () => rerender(),
    });
    setTourEventListener(() => rerender());
    // The style step passes on a click in the style list, even on the
    // style that is already active
    const pickStyle = (event) => {
      const target = event.target;
      if (session.stylePicked || !target || !target.closest) return;
      if (!target.closest('.style-item, [data-tour="add-style"]')) return;
      session.stylePicked = true;
      rerender();
    };
    window.addEventListener("resize", keepGuideInside);
    document.addEventListener("click", pickStyle, true);
    return () => {
      setTourSpotListener(null);
      setTourEventListener(null);
      window.removeEventListener("resize", keepGuideInside);
      document.removeEventListener("click", pickStyle, true);
    };
  }, []);

  // A dragged guide stays in the panel when its content grows
  React.useLayoutEffect(keepGuideInside);

  // Every change is kept: the tour resumes after it or the panel closes
  React.useEffect(saveWhatsNewProgress);

  React.useEffect(() => {
    if (session.practiceTabId && state.currentTabId !== session.practiceTabId) session.leftPracticeTab = true;
  }, [state.currentTabId]);

  // A role exercise (shout, narration) starts from the current style: the
  // copy the user makes is told apart from the styles already there, and the
  // style editor, which activates the style it saves, gives the current style
  // back afterwards
  React.useEffect(() => {
    const role = step && stepTodo ? step.role : null;
    if (!role || session[role + "KnownIds"]) return;
    session[role + "KnownIds"] = (state.styles || []).map((style) => style.id);
    session[role + "BaseId"] = state.currentStyleId || null;
    session.styleBeforeRole = { role, id: state.currentStyleId || null };
    rerender();
  }, [step && step.id, stepTodo]);

  React.useEffect(() => {
    const before = session.styleBeforeRole;
    const made = before ? env[before.role + "Style"] : null;
    if (!made) return;
    session.styleBeforeRole = null;
    if (state.currentStyleId === made.id && before.id !== made.id &&
      (state.styles || []).some((style) => style.id === before.id)) {
      dispatch({ type: "setCurrentStyleId", id: before.id });
    }
  }, [shoutStyle && shoutStyle.id, narrationStyle && narrationStyle.id, state.currentStyleId]);

  // A step that checks a style made during it (`known`) or a gesture
  // (`event`) takes its baseline when it begins.
  React.useEffect(() => {
    if (!step || !stepTodo) return;
    let changed = false;
    if (step.known && !session.known[step.id]) {
      session.known[step.id] = (state.styles || []).map((style) => style.id);
      session.styleBefore = { stepId: step.id, id: state.currentStyleId || null };
      changed = true;
    }
    if (step.event && typeof session.eventStart[step.id] !== "number") {
      session.eventStart[step.id] = tourEventCount(step.event);
      changed = true;
    }
    if (changed) rerender();
  }, [step && step.id, stepTodo]);

  // With `reselectLine`, once the step is done the style picked by the tag
  // of the current line becomes the current style, as when the user moves to
  // that line (a paste uses the current style). The line is already current,
  // so moving to it again would not switch the style.
  React.useEffect(() => {
    const before = session.styleBefore;
    if (!before || !session.done[before.stepId]) return;
    session.styleBefore = null;
    const reselect = chapters.some((item) => item.steps.some((entry) => entry.id === before.stepId && entry.reselectLine));
    const line = reselect && state.lines ? state.lines[state.currentLineIndex] : null;
    if (line && line.style && line.style.id !== state.currentStyleId) {
      dispatch({ type: "setCurrentStyleId", id: line.style.id });
    }
  });

  // Baselines of the exercises that count actions from the chapter start
  React.useEffect(() => {
    // What the star learns in the TextShapeR chapter is only for the tour
    if (chapter && chapter.id === "textShapeR") backupTourTuning(getState());
    else restoreTourTuning(dispatch);
    if (!chapter) return;
    if (chapter.id === "textShapeR" && session.textShapeRAppliedAtStart === null) {
      session.textShapeRAppliedAtStart = state.textShapeRAppliedThisSession || 0;
      session.textShapeRLearnedAtStart = state.textShapeRLearnedThisSession || 0;
    }
  }, [chapter && chapter.id]);

  /* ------------------------------ actions ------------------------------ */

  const close = () => {
    clearTourSpot();
    restoreTourTuning(dispatch);
    session.coach = null;
    endWhatsNewSession();
    dispatch({ type: course.completeAction });
  };
  const setMinimized = (value) => {
    session.minimized = value;
    rerender();
  };
  // Escape folds the guide away instead of closing it
  useModalClose(() => setMinimized(true));

  const goTo = (index) => {
    const target = Math.max(0, Math.min(chapters.length + 1, index));
    if (!chapterOpen(target)) return;
    session.chapter = target;
    rerender();
  };

  const focusStep = (chapterId, index) => {
    // A skipped step opened again is to do after all
    const target = chapters.find((item) => item.id === chapterId);
    const id = target && target.steps[index] && target.steps[index].id;
    if (id && session.done[id] === "skipped") delete session.done[id];
    session.focus[chapterId] = index;
    rerender();
  };

  // A step the user already knows: the guide moves on to the next one
  const skipStep = () => {
    if (!step || !stepTodo) return;
    session.done[step.id] = "skipped";
    delete session.focus[chapter.id];
    rerender();
  };

  const openPracticePage = async () => {
    try {
      const path = await getPracticePagePath();
      openFile(path, false, (result) => {
        if (result && result.ok) {
          session.pageOpened = true;
          rerender();
        } else {
          dispatch({ type: "showNotice", text: locale.whatsNewPracticePageError || "The practice page could not be opened.", kind: "warning" });
        }
      });
    } catch (error) {
      dispatch({ type: "showNotice", text: locale.whatsNewPracticePageError || "The practice page could not be opened.", kind: "warning" });
    }
  };

  const loadPracticeScript = () => {
    if (practiceTab) {
      dispatch({ type: "switchTab", id: session.practiceTabId });
      return;
    }
    // A practice tab left by an earlier tour is picked up again, blank: this
    // run has not pasted anything yet
    const script = buildPracticeScript();
    const existing = (getState().tabs || []).find((tab) => String(tab.text || "").trim() === script.trim());
    if (existing) {
      session.practiceTabId = existing.id;
      session.leftPracticeTab = false;
      dispatch({ type: "switchTab", id: existing.id });
      dispatch({ type: "clearPastedLines" });
      rerender();
      return;
    }
    // getState() only catches up on the next render: the tab id is set here,
    // not read back after the dispatch
    const id = "practice-" + Math.random().toString(36).substr(2, 8);
    session.previousTabId = getState().currentTabId;
    session.practiceTabId = id;
    session.leftPracticeTab = false;
    dispatch({
      type: "addTab",
      id,
      name: course.practiceTabName(),
      data: { text: script, currentLineIndex: 0 },
    });
    rerender();
  };

  const runAction = (action) => {
    if (action.type === "openPage") return openPracticePage();
    if (action.type === "loadScript") return loadPracticeScript();
    // Fallbacks, only when the real control is hidden in the layout
    if (action.type === "paste") return pasteInSelection({ state: getState(), getState, dispatch });
    if (action.type === "editStyle") return currentStyle ? dispatch({ type: "setModal", modal: "editStyle", data: currentStyle }) : undefined;
    if (action.type === "autoCenter") {
      return dispatch({ type: "setAutoCenterMode", value: nextAutoCenterMode(state.autoCenterMode || "off") });
    }
    if (action.type === "align") {
      const current = getState();
      return alignTextLayerToSelection(current.resizeTextBoxOnCenter, current.internalPadding || 0, undefined, current.direction);
    }
    return undefined;
  };

  /* ----------------------------- rendering ----------------------------- */

  const renderToggle = (toggle) => {
    const on = state[toggle.field] === true || (toggle.field === "smartPasteDistribute" && state.smartPasteDistribute !== false);
    return (
      <button
        key={toggle.field}
        type="button"
        className={`whats-new-toggle${on ? " m-on" : ""}`}
        aria-pressed={on}
        onClick={() => dispatch({ type: toggle.action, value: !on })}
      >
        <span className="whats-new-toggle-track"><span className="whats-new-toggle-thumb" /></span>
        <span>{toggle.label}</span>
        <b>{on ? locale.multiBubbleModeOn || "ON" : locale.multiBubbleModeOff || "OFF"}</b>
      </button>
    );
  };

  const actionLabel = (action) => {
    if (action.label) return action.label;
    if (action.type === "openPage") return session.pageOpened
      ? locale.whatsNewPrepOpenAgain || "Open it again"
      : locale.whatsNewPrepOpenButton || "Open the practice page";
    if (action.type === "loadScript") return practiceTab
      ? locale.whatsNewPrepScriptBack || "Back to the practice tab"
      : locale.whatsNewPrepScriptButton || "Load the practice script";
    if (action.type === "paste") return locale.whatsNewPasteButton || "Paste in the selection";
    if (action.type === "editStyle") return locale.whatsNewEditCurrentStyle || "Edit the current style";
    if (action.type === "align") return locale.alignLayer || "Align";
    if (action.type === "autoCenter") {
      const mode = state.autoCenterMode || "off";
      return (locale.autoCenterModeLabel || "Auto-center") + " · " + (mode === "multi"
        ? locale.autoCenterModeMulti || "MULTI"
        : mode === "off" ? locale.multiBubbleModeOff || "OFF" : locale.multiBubbleModeOn || "ON");
    }
    return "";
  };

  const renderActions = (actions) => {
    if (!actions || !actions.length) return null;
    return (
      <div className="whats-new-actions">
        {actions.map((action, index) => (action.type === "toggle"
          ? renderToggle(action)
          : (
            <button
              key={index}
              type="button"
              className={action.type === "openPage" || action.type === "loadScript" ? "topcoat-button--large--cta" : "topcoat-button--large"}
              onClick={() => runAction(action)}
            >
              {actionLabel(action)}
            </button>
          )))}
      </div>
    );
  };

  // The real control is hidden in this layout (footer toggles, Paste
  // button…): the guide offers it, once
  const renderFallback = (actions) => (spotMissing && actions && actions.length ? (
    <div className="whats-new-fallback">
      <span>{locale.whatsNewHiddenControl || "This control is hidden in your panel layout. Use this one instead:"}</span>
      {renderActions(actions)}
    </div>
  ) : null);

  // The user's own shortcuts, as keycaps
  const renderKeys = (ids) => {
    const items = (ids || [])
      .map((id) => ({ id, keys: state.shortcut && state.shortcut[id] }))
      .filter((item) => hasKeys(item.keys));
    if (!items.length) return null;
    return (
      <div className="whats-new-keys">
        <span>{locale.whatsNewKeysLabel || "Shortcut:"}</span>
        {items.map((item, index) => (
          <span key={item.id} className="whats-new-keys-group">
            {index > 0 && <span className="whats-new-keys-sep">·</span>}
            {items.length > 1 && <small>{locale["shortcut_" + item.id] || item.id}</small>}
            {item.keys.map((key, keyIndex) => (
              <kbd key={keyIndex}>{shortcutKeyLabels[String(key).toUpperCase()] || key}</kbd>
            ))}
          </span>
        ))}
      </div>
    );
  };

  // What the step needs before it can pass: a setting, the practice tab,
  // the right current line. Each one says where to do it in the panel.
  const renderNeeds = () => {
    const warnings = [];
    if (settingNeeds.length) {
      warnings.push(
        <div key="needs" className="whats-new-warning">
          <span>{locale.whatsNewNeedsSetting || "Turn this on first:"}</span>
          <div className="whats-new-actions">{settingNeeds.map(renderToggle)}</div>
        </div>
      );
    } else if (footerNeed) {
      warnings.push(
        <div key="footer" className="whats-new-warning">
          <span>{fill(locale.whatsNewNeedsFooter || "Turn on “{label}” at the bottom of the panel.", { label: footerNeed.label })}</span>
          {renderFallback([{ type: "toggle", field: footerNeed.field, action: footerNeed.action, label: footerNeed.label }])}
        </div>
      );
    } else if (lineProblem === "script") {
      warnings.push(
        <div key="tab" className="whats-new-warning">
          <span>{locale.whatsNewNeedsScript || "This exercise uses the practice script."}</span>
          {renderActions([{ type: "loadScript" }])}
        </div>
      );
    } else if (lineProblem === "tab") {
      warnings.push(
        <div key="tab" className="whats-new-warning">
          <span>{fill(locale.whatsNewNeedsPracticeTab || "You are on another tab: click the “{name}” tab above the script.", {
            name: practiceTab.name || course.practiceTabName(),
          })}</span>
        </div>
      );
    } else if (lineProblem === "line") {
      warnings.push(
        <div key="line" className="whats-new-warning">
          <span>{fill(locale.whatsNewWrongLine || "This bubble takes line {number}: click the target at the start of that line in the script.", { number: line })}</span>
          {renderKeys(["previous", "next"])}
        </div>
      );
    }
    return warnings;
  };

  const renderChapter = () => {
    const allDone = firstTodo === -1;
    // What the user just did: the step opened again when it is done, else
    // the last step done before the current one
    let resultIndex = typeof focused === "number" && states[focused] === "done" ? focused : -1;
    for (let i = (current === -1 ? states.length : current) - 1; resultIndex === -1 && i >= 0; i--) {
      if (states[i] === "done") resultIndex = i;
    }
    const resultStep = resultIndex >= 0 ? chapter.steps[resultIndex] : null;
    const resultText = resultStep && textOf(resultStep.result, env);
    // The chapter's art and intro until its first step is done
    const started = states[0] !== "todo";
    const blocked = settingNeeds.length || footerNeed || lineProblem;

    return (
      <React.Fragment>
        {!started && course.art[chapter.id] && <div className="whats-new-art">{course.art[chapter.id]}</div>}
        <div className="whats-new-meta">
          <span>{fill(locale.whatsNewChapterCount || "Chapter {current} of {total}", { current: view, total: chapters.length })}</span>
          <span><FiClock size={11} /> {"≈ " + formatMinutes(chapter.minutes)}</span>
        </div>
        <h2>{chapter.title}</h2>
        {!started && <p>{chapter.intro}</p>}
        <div className="whats-new-steps" aria-label={locale.walkthroughProgress || "Walkthrough progress"}>
          {chapter.steps.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={`whats-new-step-pill m-${states[index]}${index === current ? " m-current" : ""}`}
              title={states[index] === "skipped"
                ? (locale.whatsNewSkippedStep || "Skipped: click to do it after all.") + "\n" + textOf(item.text, env)
                : textOf(item.text, env)}
              disabled={states[index] === "todo" && index !== firstTodo}
              onClick={() => focusStep(chapter.id, index)}
            >
              {states[index] === "done" ? <FiCheck size={11} /> : index + 1}
            </button>
          ))}
          <span className="whats-new-steps-count">
            {fill(locale.whatsNewStepsDone || "{done}/{total} done", {
              done: states.filter((value) => value !== "todo").length,
              total: states.length,
            })}
          </span>
        </div>
        {resultText && (
          <div className="whats-new-result" key={"result-" + resultStep.id}>
            <FiCheck size={14} />
            <span>{resultText}</span>
          </div>
        )}
        {step && (
          <div className={`whats-new-task${stepTodo ? "" : " m-again"}`} key={"task-" + step.id}>
            <div className="whats-new-task-title">
              {fill(locale.whatsNewStepTitle || "Step {current}", { current: current + 1 })}
              {states[current] === "done" && <span className="whats-new-badge">{locale.walkthroughDoneStatus || "Done"}</span>}
              {stepTodo && (
                <button
                  type="button"
                  className="whats-new-skip"
                  title={locale.whatsNewSkipStepHint || "You already know this: go to the next step."}
                  onClick={skipStep}
                >
                  {locale.whatsNewSkipStep || "Skip"} <FiSkipForward size={11} />
                </button>
              )}
            </div>
            <p>{textOf(step.text, env)}</p>
            {stepTodo && step.again && session.startValues && session.startValues[step.id] !== undefined && (
              <div className="whats-new-hint">{step.again()}</div>
            )}
            {presetOn && !session.presetOff[step.id] && (
              <div className="whats-new-hint">{locale.whatsNewAlreadyOn || "Already on: nothing to do, the guide moves on."}</div>
            )}
            {stepTodo && step.miss && textOf(step.miss, env) && (
              <div className="whats-new-warning"><span>{textOf(step.miss, env)}</span></div>
            )}
            {stepTodo && renderNeeds()}
            {stepTodo && !blocked && (
              <React.Fragment>
                {renderActions(step.actions)}
                {step.paste && clickPastes && (
                  <div className="whats-new-hint">{locale.whatsNewClickPastes || "Paste on click is on: the Magic Wand click is enough."}</div>
                )}
                {renderKeys(step.paste ? (clickPastes ? [] : ["add"]) : step.keys)}
                {renderFallback(step.paste ? [{ type: "paste" }] : step.fallback)}
              </React.Fragment>
            )}
          </div>
        )}
        {allDone && current === -1 && (
          <div className="whats-new-complete">
            <FiCheck size={16} /> {locale.whatsNewChapterDone || "Chapter done!"}
          </div>
        )}
      </React.Fragment>
    );
  };

  const totalMinutes = chapters.reduce((sum, item) => sum + item.minutes, 0);

  const renderContents = () => (
    <div className="whats-new-topics">
      {chapters.map((item, index) => {
        const complete = chapterComplete(item, env);
        const locked = !chapterOpen(index + 1);
        return (
          <button
            key={item.id}
            type="button"
            className={`whats-new-topic${complete ? " m-done" : ""}${locked ? " m-locked" : ""}`}
            disabled={locked}
            title={locked ? locale.whatsNewChapterLocked || "Finish the chapters before this one first." : undefined}
            onClick={() => goTo(index + 1)}
          >
            {complete ? <FiCheck size={14} className="whats-new-topic-check" /> : locked ? <FiLock size={14} /> : <item.Icon size={14} />}
            <span>{item.title}</span>
            <small>{formatMinutes(item.minutes)}</small>
            <FiChevronRight size={13} className="whats-new-topic-chevron" />
          </button>
        );
      })}
    </div>
  );

  const renderIntro = () => (
    <React.Fragment>
      <div className="whats-new-hero">{course.hero}</div>
      <h2>{course.intro.title()}</h2>
      <p>{course.intro.text()}</p>
      <div className="whats-new-where">{course.intro.spot()}</div>
      <div className="whats-new-total">
        <FiClock size={13} /> {fill(locale.whatsNewTotalTime || "About {time} in all", { time: formatMinutes(totalMinutes) })}
      </div>
      {renderContents()}
    </React.Fragment>
  );

  // Leaves the tour for another window or tour (end screen buttons)
  const leave = () => {
    clearTourSpot();
    session.coach = null;
    endWhatsNewSession();
    dispatch({ type: course.completeAction });
  };

  const renderEnd = () => {
    const done = chapters.filter((item) => chapterComplete(item, env)).length;
    const spent = Math.max(1, Math.round((Date.now() - session.startedAt) / 60000));
    return (
      <React.Fragment>
        <div className="whats-new-hero m-done"><FiCheck size={30} /></div>
        <h2>{course.end.title()}</h2>
        <p>
          {fill(locale.whatsNewDoneSummary || "{done} of {total} chapters done, in {minutes} min.", {
            done,
            total: chapters.length,
            minutes: spent,
          })}
        </p>
        {renderContents()}
        <div className="whats-new-where">
          {locale.whatsNewDoneCleanup || "Close the practice page in Photoshop without saving it."}
        </div>
        <div className="whats-new-actions">
          {practiceTab && (state.tabs || []).length > 1 && (
            <button
              type="button"
              className="topcoat-button--large"
              onClick={() => {
                dispatch({ type: "deleteTab", id: session.practiceTabId });
                session.practiceTabId = null;
                rerender();
              }}
            >
              {locale.whatsNewCloseTab || "Close the practice tab"}
            </button>
          )}
          {course.end.next && (
            <button
              type="button"
              className="topcoat-button--large"
              onClick={() => {
                leave();
                dispatch({ type: "setModal", modal: course.end.next.modal, data: { source: course.id } });
              }}
            >
              <FiPlayCircle size={15} /> {course.end.next.label()}
            </button>
          )}
        </div>
        {course.end.notes().map((note, index) => <p key={index} className="whats-new-note">{note}</p>)}
      </React.Fragment>
    );
  };

  // The guide is dragged by its header; a drop over the ring keeps it there
  // until the next target
  const dragGuide = (event) => startGuideDrag(event, spotKey);

  // A run left unfinished: go on with it, or start again from zero
  const answerResume = (resume) => {
    resumeWhatsNewSession(resume);
    rerender();
  };

  const renderResume = () => {
    const saved = session.resumeOffer;
    return (
      <React.Fragment>
        <div className="whats-new-hero">{course.hero}</div>
        <h2>{locale.whatsNewResumeTitle || "Pick up where you left off?"}</h2>
        <p>
          {fill(locale.whatsNewResumeText || "You stopped at chapter {number} of {total}: {title}.", {
            number: saved.chapter,
            total: chapters.length,
            title: chapters[saved.chapter - 1].title,
          })}
        </p>
        <div className="whats-new-actions">
          <button type="button" className="topcoat-button--large--cta" onClick={() => answerResume(true)}>
            <FiPlayCircle size={15} /> {locale.whatsNewResume || "Resume"}
          </button>
          <button type="button" className="topcoat-button--large" onClick={() => answerResume(false)}>
            <FiRotateCcw size={15} /> {locale.whatsNewRestart || "Start over"}
          </button>
        </div>
      </React.Fragment>
    );
  };

  const isEnd = view > chapters.length;
  const headerTitle = chapter ? chapter.title : course.title();

  if (session.minimized) {
    return (
      <div className="app-modal-header whats-new-mini whats-new-drag" onMouseDown={dragGuide}>
        <button type="button" className="whats-new-mini-title" onClick={() => setMinimized(false)}>
          <FiChevronDown size={15} />
          <span>{headerTitle}</span>
          {chapter && <small>{fill(locale.whatsNewStepsDone || "{done}/{total} done", {
            done: states.filter((value) => value !== "todo").length,
            total: states.length,
          })}</small>}
        </button>
        <button className="topcoat-icon-button--large--quiet" title={locale.close} onClick={close}>
          <FiX size={16} />
        </button>
      </div>
    );
  }

  return (
    <React.Fragment>
      <div
        className="app-modal-header hostBrdBotContrast whats-new-drag"
        title={locale.whatsNewDragGuide || "Drag to move the guide"}
        onMouseDown={dragGuide}
      >
        <div className="app-modal-title whats-new-title">
          <MdDragIndicator size={16} className="whats-new-grip" aria-hidden="true" />
          {course.title()}
        </div>
        <div className="whats-new-header-actions">
          <button
            className="topcoat-icon-button--large--quiet"
            title={locale.whatsNewMinimize || "Fold the guide (Esc)"}
            onClick={() => setMinimized(true)}
          >
            <FiChevronUp size={18} />
          </button>
          <button className="topcoat-icon-button--large--quiet" title={locale.close} onClick={close}>
            <FiX size={18} />
          </button>
        </div>
      </div>
      <div className="app-modal-body">
        <div className="app-modal-body-inner walkthrough whats-new" key={session.resumeOffer ? "resume" : view}>
          {session.resumeOffer ? renderResume() : chapter ? renderChapter() : isEnd ? renderEnd() : renderIntro()}
        </div>
      </div>
      {!session.resumeOffer && <div className="app-modal-footer hostBrdTopContrast walkthrough-footer">
        <button
          type="button"
          className="topcoat-button--large"
          onClick={() => goTo(0)}
          disabled={view === 0}
          title={locale.whatsNewContents || "Contents"}
        >
          <FiList size={15} />
        </button>
        <div className="walkthrough-footer-nav">
          {view > 0 && (
            <button type="button" className="topcoat-button--large" onClick={() => goTo(view - 1)} title={locale.walkthroughBack || "Back"}>
              <FiChevronLeft size={16} />
            </button>
          )}
          <button
            type="button"
            className="topcoat-button--large--cta"
            disabled={!isEnd && !chapterOpen(view + 1)}
            title={!isEnd && !chapterOpen(view + 1) ? locale.whatsNewNextLocked || "Do the steps of this chapter to go on." : undefined}
            onClick={isEnd ? close : () => goTo(view + 1)}
          >
            {isEnd ? <FiCheck size={16} /> : <FiChevronRight size={16} />}
            {isEnd
              ? locale.walkthroughDone || "Done"
              : view === 0
                ? locale.whatsNewStart || "Start"
                : locale.walkthroughNext || "Next"}
          </button>
        </div>
      </div>}
    </React.Fragment>
  );
});

export default TourModal;
