import React from "react";
import {
  FiCheck,
  FiChevronDown,
  FiChevronLeft,
  FiChevronRight,
  FiChevronUp,
  FiClock,
  FiColumns,
  FiFileText,
  FiList,
  FiLock,
  FiPlayCircle,
  FiRotateCcw,
  FiSearch,
  FiX,
} from "react-icons/fi";
import { MdAdsClick, MdCleaningServices, MdDragIndicator, MdFormatShapes, MdOutlineAutoAwesome } from "react-icons/md";

import { useContext } from "../../context";
import { useModalClose } from "../../modalClose";
import { pasteInSelection, nextAutoCenterMode, shortcutKeyLabels } from "../../shortcutCommands";
import { locale, openFile, scrollToLine } from "../../utils";
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

/* ============================ illustrations ============================ */

// Text lines drawn as rounded bars, centred on cx
const Bars = ({ cx, rows, className }) => (
  <g className={className}>
    {rows.map(([y, width], index) => (
      <rect key={index} className={`whats-new-bar m-row${index + 1}`} x={cx - width / 2} y={y + 1} width={width} height={4.5} rx={2.25} />
    ))}
  </g>
);

// 2.5 filled the selection rectangle, 3.0 follows the bubble outline
const SmartPasteArt = () => (
  <svg viewBox="0 0 220 96" className="whats-new-svg">
    <ellipse className="whats-new-bubble" cx="55" cy="50" rx="44" ry="32" />
    <rect className="whats-new-selection" x="11" y="18" width="88" height="64" />
    <Bars cx={55} className="whats-new-bars m-old" rows={[[30, 74], [40, 74], [50, 74], [60, 74]]} />
    <text className="whats-new-tag" x="55" y="12">2.5</text>
    <path className="whats-new-arrow" d="M104 50h12m-5-5l5 5-5 5" />
    <ellipse className="whats-new-bubble" cx="165" cy="50" rx="44" ry="32" />
    <Bars cx={165} className="whats-new-bars m-animated" rows={[[30, 36], [40, 62], [50, 66], [60, 44]]} />
    <text className="whats-new-tag m-accent" x="165" y="12">3.0</text>
  </svg>
);

// The cursor clicks the bubble, the selection appears, the line is pasted
const PasteOnClickArt = () => (
  <svg viewBox="0 0 220 96" className="whats-new-svg">
    <ellipse className="whats-new-bubble" cx="110" cy="48" rx="54" ry="36" />
    <ellipse className="whats-new-ants" cx="110" cy="48" rx="54" ry="36" />
    <circle className="whats-new-ripple" cx="110" cy="48" r="10" />
    <Bars cx={110} className="whats-new-bars m-after-click" rows={[[33, 44], [43, 74], [53, 64]]} />
    <g className="whats-new-cursor">
      <path d="M110 48l0 17 4.5-4.5 3.5 8 3-1.4-3.5-7.8h6.5z" />
    </g>
  </svg>
);

// Black bubble, double bubble and shout bubble
const BubblesArt = () => (
  <svg viewBox="0 0 220 96" className="whats-new-svg">
    <ellipse className="whats-new-bubble m-black" cx="36" cy="50" rx="30" ry="26" />
    <Bars cx={36} className="whats-new-bars m-white" rows={[[38, 26], [47, 40], [56, 30]]} />
    <ellipse className="whats-new-bubble" cx="92" cy="40" rx="24" ry="20" />
    <ellipse className="whats-new-bubble" cx="122" cy="62" rx="24" ry="20" />
    <Bars cx={92} className="whats-new-bars m-animated" rows={[[32, 24], [41, 32]]} />
    <Bars cx={122} className="whats-new-bars m-animated m-second" rows={[[54, 30], [63, 22]]} />
    <path
      className="whats-new-bubble"
      d="M184 18l6 14 14-8-4 15 15 2-12 9 12 10-15 1 4 15-14-8-6 14-6-14-14 8 4-15-15-1 12-10-12-9 15-2-4-15 14 8z"
    />
    <Bars cx={184} className="whats-new-bars m-bold" rows={[[43, 26], [52, 18]]} />
  </svg>
);

// Three suggested layouts, the chosen one is starred
const TextShapeRArt = () => (
  <svg viewBox="0 0 220 96" className="whats-new-svg">
    {[
      { cx: 40, rows: [[34, 44], [44, 44], [54, 44]] },
      { cx: 110, rows: [[30, 26], [40, 44], [50, 48], [60, 30]], chosen: true },
      { cx: 180, rows: [[39, 52], [49, 52]] },
    ].map((shape) => (
      <g key={shape.cx} className={shape.chosen ? "whats-new-choice m-chosen" : "whats-new-choice"}>
        <rect className="whats-new-card" x={shape.cx - 34} y="14" width="68" height="66" rx="6" />
        <ellipse className="whats-new-bubble" cx={shape.cx} cy="47" rx="28" ry="24" />
        <Bars cx={shape.cx} className="whats-new-bars" rows={shape.rows} />
      </g>
    ))}
    <path className="whats-new-star" d="M138 10l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" />
  </svg>
);

const ART = {
  smartPaste: <SmartPasteArt />,
  pasteOnClick: <PasteOnClickArt />,
  bubbles: <BubblesArt />,
  textShapeR: <TextShapeRArt />,
};

/* ============================== helpers =============================== */

const fill = (text, values) => Object.keys(values).reduce((out, key) => out.split("{" + key + "}").join(values[key]), text);

// 1.5 -> "1 min 30", 0.5 -> "30 s"
const formatMinutes = (minutes) => {
  const whole = Math.floor(minutes);
  const seconds = Math.round((minutes - whole) * 60);
  if (!whole) return fill(locale.whatsNewTimeSeconds || "{count} s", { count: seconds });
  if (!seconds) return fill(locale.whatsNewTimeMinutes || "{count} min", { count: whole });
  return fill(locale.whatsNewTimeMinutesSeconds || "{minutes} min {seconds}", { minutes: whole, seconds });
};

const isUxp = () => typeof window !== "undefined" && !!window.typerUXP;
const hasKeys = (keys) => Array.isArray(keys) ? keys.length > 0 : !!keys;

/* ============================== chapters ============================== */

// Spotlight candidates (whatsNewSpotlight.js): the real controls carry a
// data-tour attribute
const tour = (name) => ({ selector: `[data-tour="${name}"]` });
const unlessActive = (tabId) => ({ selector: `[data-tour="settings-${tabId}"]:not(.settings-tab--active)` });
const byId = (id) => `[id=${JSON.stringify(String(id))}]`;
const styleItem = (id) => (id ? { selector: `.style-item${byId(id)}` } : null);
const stylePencil = (id) => (id ? { selector: `.style-item${byId(id)} [data-tour="edit-style"]` } : null);
const tabOf = (id) => (id ? { selector: `[data-tour-tab=${JSON.stringify(String(id))}]` } : null);
const activeSettingsTab = (tabId) => `.settings-tab--active[data-tour="settings-${tabId}"]`;

// The copy of the dialogue style the user just duplicated for a role
// exercise ("shout", "narration"): a style that was not there when the step
// began
const roleCopyId = (role, env) => {
  const id = env.state.currentStyleId;
  const known = session[role + "KnownIds"];
  if (!id || !known || known.indexOf(id) !== -1) return null;
  return env.currentStyle && env.currentStyle.bubbleType !== role ? id : null;
};

// Styles marked for a role, anywhere: a new one passes the exercise
const roleStyleIds = (role, env) => (env.state.styles || [])
  .filter((style) => style.bubbleType === role).map((style) => style.id).sort().join();

// Where the role exercise is: the bubble type field in the editor, the
// pencil of the copy, or Duplicate on the dialogue style
const roleSpot = (role, env) => [tour("bubble-type")].concat(roleCopyId(role, env)
  ? [stylePencil(roleCopyId(role, env))]
  : [tour("duplicate-style"), styleItem(session[role + "BaseId"] || env.state.currentStyleId)]);

// Each step is checked from the panel state: it passes by itself when the
// user does it, in Photoshop or in the panel. The guide never does the
// gesture: `spot` rings the control to use, `fallback` is offered only when
// that control is hidden in the user's layout. env: see WhatsNewModal.
const getChapters = () => [
  {
    id: "prep",
    Icon: FiFileText,
    minutes: 0.5,
    title: locale.whatsNewPrepTitle || "Get ready",
    intro:
      locale.whatsNewPrepIntro ||
      "The tour is hands-on: TypeR opens a practice page with numbered bubbles and a practice script, one line per bubble.",
    steps: [
      {
        id: "openPage",
        text: locale.whatsNewPrepOpenText || "Open the practice page in Photoshop.",
        check: () => session.pageOpened === true,
        actions: [{ type: "openPage" }],
        result:
          locale.whatsNewPrepOpenResult ||
          "It opens as a normal document: 10 numbered spots, one per exercise, read from right to left like a manga. Close it without saving at the end.",
      },
      {
        id: "loadScript",
        text: locale.whatsNewPrepScriptText || "Load the practice script. It opens in a new tab: your own scripts stay untouched.",
        check: (env) => env.onPracticeTab,
        actions: [{ type: "loadScript" }],
        result: locale.whatsNewPrepScriptResult || "Each line of this script goes into the bubble with the same number.",
      },
      {
        id: "style",
        coachIn: "editStyle",
        text: (env) => (env.state.styles.length
          ? locale.whatsNewPrepStyleText ||
            "Click the style you usually use for dialogue in the style list. The exercises use it."
          : locale.whatsNewPrepStyleCreateText ||
            "You have no style yet: click “Add style” under the style list to create your dialogue style."),
        coach: locale.whatsNewPrepStyleCoach || "Name the style, pick the font you use for dialogue, then click Save.",
        // A style already active does not count: the user picks it (or
        // creates one) in this run
        check: (env) => !!env.currentStyle && session.stylePicked === true,
        spot: (env) => (env.state.styles.length ? [{ selector: ".folders-list" }] : [tour("add-style")]),
        result: locale.whatsNewPrepStyleResult || "Ready. Keep this guide open: it checks each exercise by itself.",
      },
    ],
  },
  {
    id: "smartPaste",
    Icon: MdOutlineAutoAwesome,
    minutes: 0.5,
    title: locale.whatsNewSmartPasteTitle || "Smart paste",
    intro:
      locale.whatsNewSmartPasteIntro ||
      "Until 2.5, the text filled the rectangle of the selection. TypeR now reads the real outline of the bubble and lays the text out inside it.",
    needs: [{ field: "smartPaste", action: "setSmartPaste", label: locale.settingsSmartPasteLabel || "Smart paste" }],
    steps: [
      {
        id: "bubble1",
        line: 1,
        text:
          locale.whatsNewSmartPasteStep1 ||
          "Bubble 1: in Photoshop, take the Magic Wand (W) and click inside the big bubble. Then click Paste in the panel.",
        paste: true,
        result:
          locale.whatsNewSmartPasteResult1 ||
          "The lines follow the curve: short at the top and bottom, long in the middle, and the block is centered in the bubble. The style size was kept because the text fits.",
      },
      {
        id: "bubble2",
        line: 2,
        text: locale.whatsNewSmartPasteStep2 || "Bubble 2: same gesture in the small bubble. This line is too long for it…",
        paste: true,
        result:
          locale.whatsNewSmartPasteResult2 ||
          "…so TypeR shrank the text just enough to fit, down to 70% of the style size at most. One hyphen is allowed only as a last resort. Both can be changed in Settings > Behavior.",
      },
    ],
  },
  {
    id: "pasteOnClick",
    Icon: MdAdsClick,
    minutes: 0.75,
    title: locale.whatsNewPasteOnClickTitle || "Paste on click",
    intro:
      locale.whatsNewPasteOnClickIntro ||
      "No paste needed any more: the selection is enough. Each Magic Wand click (or rectangle, or lasso) pastes the current line and moves to the next one.",
    needs: [{ field: "smartPaste", action: "setSmartPaste", label: locale.settingsSmartPasteLabel || "Smart paste" }],
    steps: [
      {
        id: "enableClick",
        text: locale.whatsNewPasteOnClickStep1 || "Turn on “Click paste” at the bottom of the panel.",
        check: (env) => env.state.pasteOnClick === true,
        preset: true,
        spot: () => [tour("mode-pasteOnClick")],
        keys: ["togglePasteOnClick"],
        fallback: [{ type: "toggle", field: "pasteOnClick", action: "setPasteOnClick", label: locale.footerPasteOnClick || "Click paste" }],
        result: locale.whatsNewPasteOnClickResult1 || "It is on. Multi-bubble mode turns off: the two do not work together.",
      },
      {
        id: "clicks",
        line: 3,
        lines: [3, 4],
        text: locale.whatsNewPasteOnClickStep2 || "With the Magic Wand, click inside bubble 3, then inside bubble 4. Nothing else to do.",
        needs: [{ field: "pasteOnClick", action: "setPasteOnClick", label: locale.footerPasteOnClick || "Click paste", footer: "pasteOnClick" }],
        result: locale.whatsNewPasteOnClickResult2 || "One click, one line: TypeR follows your clicks through the script.",
      },
      {
        // Two gestures: the undo brings line 4 back, then a click pastes it again
        id: "undo",
        text: () => (session.undoSeen
          ? locale.whatsNewPasteOnClickStep3Again || "Undone! Now click inside bubble 4 again with the Magic Wand to paste it back."
          : isUxp()
            ? locale.whatsNewPasteOnClickStep3Uxp || "Press Ctrl+Z (Cmd+Z on Mac) in Photoshop: the text of bubble 4 goes away and its line becomes the current line again."
            : locale.whatsNewPasteOnClickStep3Legacy ||
              "Press Ctrl+Z (Cmd+Z on Mac) in Photoshop, then click in the TypeR panel: the text of bubble 4 goes away and its line becomes the current line again."),
        needs: [{ field: "pasteOnClick", action: "setPasteOnClick", label: locale.footerPasteOnClick || "Click paste", footer: "pasteOnClick" }],
        check: (env) => {
          if (!session.done.clicks || !env.onPracticeTab) return false;
          // Read too fast, the step is passed by: the user went on to the
          // black bubble of the next chapter, the undo is not required
          if (env.isPasted(5)) return true;
          if (env.state.currentLineIndex === env.lineIndex(4)) {
            session.undoSeen = true;
            return false;
          }
          return !!session.undoSeen && env.isPasted(4) && env.state.currentLineIndex === env.lineIndex(5);
        },
        result:
          locale.whatsNewPasteOnClickResult3 ||
          "Bubble 4 is back. Turn the mode off when you retouch the page, or every selection pastes a line.",
      },
      {
        id: "rectangle",
        line: 5,
        text:
          locale.whatsNewPasteOnClickStep4 ||
          "No bubble at spot 5: in Photoshop, take the Rectangular Marquee (M) and draw a rectangle in the dotted frame. The line is pasted as soon as you let go.",
        needs: [{ field: "pasteOnClick", action: "setPasteOnClick", label: locale.footerPasteOnClick || "Click paste", footer: "pasteOnClick" }],
        result:
          locale.whatsNewPasteOnClickResult4 ||
          "A rectangle or a lasso places the text anywhere, even on the art: handy for captions and text outside bubbles.",
      },
    ],
  },
  {
    id: "bubbles",
    Icon: MdCleaningServices,
    minutes: 1.25,
    title: locale.whatsNewBubblesTitle || "Every kind of bubble",
    intro:
      locale.whatsNewBubblesIntro ||
      "Smart paste recognizes the kind of bubble and adapts the text. Paste on click can stay on: one click per bubble.",
    needs: [{ field: "smartPaste", action: "setSmartPaste", label: locale.settingsSmartPasteLabel || "Smart paste" }],
    steps: [
      {
        id: "black",
        line: 6,
        text: locale.whatsNewBubblesStep1 || "Bubble 6 is black: paste the next line into it.",
        paste: true,
        result: locale.whatsNewBubblesResult1 || "White text without a stroke, automatically. Your style itself does not change.",
      },
      {
        id: "double",
        line: 7,
        lines: [7, 8],
        text: locale.whatsNewBubblesStep2 || "Bubble 7 is a double bubble: one single click or paste in its upper part.",
        needs: [{ field: "smartPasteDistribute", action: "setSmartPasteDistribute", label: locale.settingsSmartPasteDistributeLabel || "Split lines across connected bubbles" }],
        paste: true,
        result:
          locale.whatsNewBubblesResult2 ||
          "Two lines, one per part, in a single history step: one Ctrl+Z undoes both. Triple bubbles work the same way.",
      },
      {
        id: "clean",
        line: 9,
        text: locale.whatsNewBubblesStep5 || "Bubble 8 still has its original lettering. Turn on Auto clean, then paste the next line into it.",
        needs: [{ field: "smartPasteAutoClean", action: "setSmartPasteAutoClean", label: locale.footerAutoClean || "Auto clean", footer: "autoClean" }],
        paste: true,
        result:
          locale.whatsNewBubblesResult5 ||
          "A “TypeR Clean” layer painted the bubble under the text: the original lettering is hidden, nothing is erased. It only works on plain white or black bubbles.",
      },
      {
        id: "shoutStyle",
        role: "shout",
        coachIn: "editStyle",
        text: (env) => (roleCopyId("shout", env)
          ? locale.whatsNewBubblesStep3Edit || "Now click the pencil of the copy to edit it."
          : locale.whatsNewBubblesStep3 ||
            "For shout bubbles, TypeR uses the style marked “Shout” in the folder of the current style. Make one from your dialogue style: right-click it in the list, then Duplicate."),
        coach:
          locale.whatsNewBubblesCoach3 ||
          "Rename it “Shout”, set Bubble type to Shout, pick a font that shouts, then click Save.",
        check: (env) => !!env.shoutStyle,
        fresh: (env) => roleStyleIds("shout", env),
        again: () => locale.whatsNewAgainShout || "You already have a Shout style from an earlier run: make a new one to do this step.",
        spot: (env) => roleSpot("shout", env),
        result:
          locale.whatsNewBubblesResult3 ||
          "The Shout style is used only for bubbles detected as shouts. A prefix on the script line always wins.",
      },
      {
        id: "shout",
        line: 10,
        text: locale.whatsNewBubblesStep4 || "Bubble 9 is spiky: paste the next line into it. Your current style is not the Shout style.",
        paste: true,
        result: (env) => (env.usedStyleId(10) && env.shoutStyle && env.usedStyleId(10) === env.shoutStyle.id
          ? locale.whatsNewBubblesResult4 || "TypeR recognized a shout and used the Shout style instead of the current style."
          : locale.whatsNewBubblesResult4Missed ||
            "The Shout style was not used: check that it is in the same folder as the current style, then try again."),
      },
      {
        id: "narrationStyle",
        role: "narration",
        coachIn: "editStyle",
        text: (env) => (roleCopyId("narration", env)
          ? locale.whatsNewBubblesStep3Edit || "Now click the pencil of the copy to edit it."
          : locale.whatsNewBubblesStep6 ||
            "Narration boxes work the same way, with the style marked “Narration”. Make one from your dialogue style too: right-click it in the list, then Duplicate."),
        coach:
          locale.whatsNewBubblesCoach6 ||
          "Rename it “Narration”, set Bubble type to Narration, pick the font of your captions, then click Save.",
        check: (env) => !!env.narrationStyle,
        fresh: (env) => roleStyleIds("narration", env),
        again: () => locale.whatsNewAgainNarration || "You already have a Narration style from an earlier run: make a new one to do this step.",
        spot: (env) => roleSpot("narration", env),
        result: locale.whatsNewBubblesResult6 || "The Narration style is used only for boxes detected as narration.",
      },
      {
        id: "narration",
        line: 11,
        text: locale.whatsNewBubblesStep7 || "Box 10 is a narration box: paste the last line into it.",
        paste: true,
        result: (env) => (env.usedStyleId(11) && env.narrationStyle && env.usedStyleId(11) === env.narrationStyle.id
          ? locale.whatsNewBubblesResult7 || "TypeR recognized a narration box and used the Narration style."
          : locale.whatsNewBubblesResult7Missed ||
            "The Narration style was not used: check that it is in the same folder as the current style, then try again."),
      },
    ],
  },
  {
    id: "textShapeR",
    Icon: MdFormatShapes,
    minutes: 0.5,
    title: locale.whatsNewTextShapeRTitle || "TextShapeR",
    intro:
      locale.whatsNewTextShapeRIntro ||
      "TextShapeR suggests several ways to break the lines of a text layer for its bubble, from the best one down. Handy to retouch a bubble already typeset.",
    steps: [
      {
        id: "enableShapeR",
        text: locale.whatsNewTextShapeRStep1 || "Turn on “TextShapeR” at the bottom of the panel.",
        check: (env) => env.state.inlineTextShapeR === true,
        preset: true,
        spot: () => [tour("mode-textShapeR")],
        keys: ["toggleTextShapeR"],
        fallback: [{ type: "toggle", field: "inlineTextShapeR", action: "setInlineTextShapeR", label: locale.textShapeRTitle || "TextShapeR" }],
        result: locale.whatsNewTextShapeRResult1 || "The suggestions appear in the panel, under the preview. You can collapse this guide (▾) to see them.",
      },
      {
        id: "applyShape",
        text:
          locale.whatsNewTextShapeRStep2 ||
          "In Photoshop, select the text layer of bubble 1 in the Layers panel, then click one of the suggested shapes in TypeR.",
        check: (env) => session.textShapeRAppliedAtStart !== null &&
          (env.state.textShapeRAppliedThisSession || 0) > session.textShapeRAppliedAtStart,
        spot: () => [{ selector: ".preview-textshaper" }],
        result:
          locale.whatsNewTextShapeRResult2 ||
          "The layer gets the new line breaks. Shift+click applies and moves to the next line; Ctrl+Z goes back.",
      },
      {
        id: "learnShape",
        text:
          locale.whatsNewTextShapeRStep3 ||
          "When a suggestion suits you, click the star: TextShapeR learns how you break your lines (no generative AI).",
        check: (env) => session.textShapeRLearnedAtStart !== null &&
          (env.state.textShapeRLearnedThisSession || 0) > session.textShapeRLearnedAtStart,
        spot: () => [{ selector: ".preview-textshaper-markbest" }],
        result: locale.whatsNewTextShapeRResult3 || "The next suggestions follow your style. This lesson is only for the tour: it is undone when you leave this chapter, so your own learning stays as it was.",
      },
    ],
  },
  {
    id: "workflow",
    Icon: FiColumns,
    minutes: 0.75,
    title: locale.whatsNewWorkflowTitle || "Organize your work",
    intro: locale.whatsNewWorkflowIntro || "Several chapters, teams or projects at once, without mixing anything.",
    steps: [
      {
        id: "tabs",
        text:
          locale.whatsNewWorkflowStep1 ||
          "Tabs: click your previous tab above the script, then come back to the practice tab. Each tab keeps its script, its current line and its PSD folder.",
        check: (env) => session.leftPracticeTab && env.onPracticeTab,
        spot: () => (session.leftPracticeTab
          ? [tabOf(session.practiceTabId)]
          : [tabOf(session.previousTabId !== session.practiceTabId && session.previousTabId), { selector: ".tab-bar-tab:not(.m-active)" }]),
        result: locale.whatsNewWorkflowResult1 || "Double-click a tab to rename it. The + button opens a new one.",
      },
      {
        id: "autoCenter",
        text:
          locale.whatsNewWorkflowStep2 ||
          "Auto-center: click it at the bottom of the panel. Center re-centers each text in its bubble after the paste; Multi handles double bubbles.",
        check: (env) => (env.state.autoCenterMode || "off") !== "off",
        preset: true,
        spot: () => [tour("mode-autoCenter")],
        keys: ["cycleAutoCenter"],
        fallback: [{ type: "autoCenter" }],
        result: locale.whatsNewWorkflowResult2 || "Click again to go back to Off if you prefer to place texts yourself.",
      },
      {
        id: "presets",
        coachIn: "editStyle",
        text:
          locale.whatsNewWorkflowStep3 ||
          "Size presets: click the pencil of your current style to open the style editor.",
        coach:
          locale.whatsNewWorkflowCoach3 ||
          "Size presets: add up to three sizes, then click one to make it active. The “Next text size preset” shortcut cycles through them.",
        visit: ".style-edit-size-section",
        spot: (env) => [{ selector: ".style-edit-size-section" }, stylePencil(env.state.currentStyleId)],
        fallback: [{ type: "editStyle" }],
        result: locale.whatsNewWorkflowResult3 || "The “Next text size preset” shortcut cycles through them without opening anything.",
      },
    ],
  },
  {
    id: "fonts",
    Icon: FiSearch,
    minutes: 0.25,
    title: locale.whatsNewFontsTitle || "Font FindeR",
    intro: locale.whatsNewFontsIntro || "Find the right font faster, without leaving Photoshop.",
    steps: [
      {
        id: "fontFinder",
        coachIn: "settings",
        text:
          locale.whatsNewFontsStep2 ||
          "Font FindeR: open the settings with the gear at the bottom of the panel, then the Font FindeR tab.",
        coach: locale.whatsNewFontsCoach || "Font FindeR: search fonts, preview them with your own text and install one in a click.",
        visit: activeSettingsTab("fontViewer"),
        spot: () => [unlessActive("fontViewer"), tour("settings")],
        result: locale.whatsNewFontsResult2 || "An installed font can be used in a style right away.",
      },
    ],
  },
];

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

const WhatsNewModal = React.memo(function WhatsNewModal() {
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
    shortcut: state.shortcut,
    uiLayout: state.uiLayout,
  }));
  const { dispatch, getState } = context;
  const state = context.state;
  const chapters = React.useMemo(getChapters, []);
  if (!session.active) startWhatsNewSession(chapters.length);
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
  };

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
    return {
      key: step.id + ":" + candidates.map((candidate) => candidate.selector || "find").join("|"),
      candidates,
      visit: step.visit,
      stepId: step.id,
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
    session.coach = stepTodo && step.coach ? { stepId: step.id, modal: step.coachIn, text: step.coach } : null;
  });

  React.useEffect(() => {
    setTourSpotListener({
      onMissing: () => rerender(),
      onChange: () => rerender(),
    });
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
    dispatch({ type: "completeWhatsNew" });
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
    session.focus[chapterId] = index;
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
      name: locale.whatsNewPracticeTab || "TypeR 3.0 practice",
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
            name: practiceTab.name || locale.whatsNewPracticeTab || "TypeR 3.0 practice",
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
        {!started && ART[chapter.id] && <div className="whats-new-art">{ART[chapter.id]}</div>}
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
              title={textOf(item.text, env)}
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
            </div>
            <p>{textOf(step.text, env)}</p>
            {stepTodo && step.again && session.startValues && session.startValues[step.id] !== undefined && (
              <div className="whats-new-hint">{step.again()}</div>
            )}
            {presetOn && !session.presetOff[step.id] && (
              <div className="whats-new-hint">{locale.whatsNewAlreadyOn || "Already on: nothing to do, the guide moves on."}</div>
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
      <div className="whats-new-hero">3.0</div>
      <h2>{locale.whatsNewIntroTitle || "Welcome to TypeR 3.0"}</h2>
      <p>
        {locale.whatsNewIntroText ||
          "A hands-on tour in Photoshop: TypeR opens a practice page and a script, and each exercise checks itself as soon as you do it. Each step unlocks the next one, and the guide moves on by itself."}
      </p>
      <div className="whats-new-where">
        {locale.whatsNewIntroSpot || "You do every gesture yourself: the guide highlights the button to use in the panel."}
      </div>
      <div className="whats-new-total">
        <FiClock size={13} /> {fill(locale.whatsNewTotalTime || "About {time} in all", { time: formatMinutes(totalMinutes) })}
      </div>
      {renderContents()}
    </React.Fragment>
  );

  const renderEnd = () => {
    const done = chapters.filter((item) => chapterComplete(item, env)).length;
    const spent = Math.max(1, Math.round((Date.now() - session.startedAt) / 60000));
    return (
      <React.Fragment>
        <div className="whats-new-hero m-done"><FiCheck size={30} /></div>
        <h2>{locale.whatsNewDoneTitle || "You are all set"}</h2>
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
          <button
            type="button"
            className="topcoat-button--large"
            onClick={() => {
              clearTourSpot();
              session.coach = null;
              endWhatsNewSession();
              dispatch({ type: "completeWhatsNew" });
              dispatch({ type: "setModal", modal: "walkthrough", data: { source: "whatsNew" } });
            }}
          >
            <FiPlayCircle size={15} /> {locale.whatsNewOpenBasics || "Basics walkthrough"}
          </button>
        </div>
        <p className="whats-new-note">
          {isUxp()
            ? locale.whatsNewDoneUxp ||
              "You are using the new TypeR (UXP): native on Apple Silicon and updated through Creative Cloud."
            : locale.whatsNewDoneLegacy ||
              "This is the Legacy version. From Photoshop 2025, TypeR offers to switch to the new TypeR (UXP), faster and native on Apple Silicon."}
        </p>
        <p className="whats-new-note">{locale.whatsNewDoneText || "Reopen this tour at any time from Help or Settings > General."}</p>
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
        <div className="whats-new-hero">3.0</div>
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
  const headerTitle = chapter ? chapter.title : locale.whatsNewTitle || "What's new in TypeR 3.0";

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
          {locale.whatsNewTitle || "What's new in TypeR 3.0"}
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

export default WhatsNewModal;
