// What's new in TypeR 3.0: the guided tour (tour.jsx) of the features added
// since 2.5, shown once to users updating from an earlier version.

import React from "react";
import { FiColumns, FiFileText, FiSearch } from "react-icons/fi";
import { MdAdsClick, MdCleaningServices, MdFormatShapes, MdOutlineAutoAwesome } from "react-icons/md";

import { locale } from "../../utils";
import { currentFolderStyles, whatsNewSession as session } from "../../whatsNewSession";
import TourModal, { Bars, fill, isUxp, stylePencil, styleItem, tabOf, tour, unlessActive, activeSettingsTab } from "./tour";

/* ============================ illustrations ============================ */

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

/* ============================== chapters ============================== */


// The copy of the dialogue style the user just duplicated for a role
// exercise ("shout", "narration"): a style that was not there when the step
// began
const roleCopyId = (role, env) => {
  const id = env.state.currentStyleId;
  const known = session[role + "KnownIds"];
  if (!id || !known || known.indexOf(id) !== -1) return null;
  return env.currentStyle && env.currentStyle.bubbleType !== role ? id : null;
};

// The styles of the current folder that can take a role: any style not
// marked yet, but the dialogue style the exercise starts from (smart paste
// keeps it for the other bubbles)
const roleChoices = (role, env) => {
  const baseId = session[role + "BaseId"] || env.state.currentStyleId;
  return currentFolderStyles(env.state).filter((style) => style.id !== baseId && !style.bubbleType);
};

// Where the role exercise is: the bubble type field in the editor, the
// pencil of the copy, or the style list. No style is forced: the pencil of
// every style that can take the role is outlined (roleMarks), and Duplicate
// is there for a copy of the dialogue style.
const roleSpot = (role, env) => {
  const copy = roleCopyId(role, env);
  const base = session[role + "BaseId"] || env.state.currentStyleId;
  return [tour("bubble-type")].concat(copy
    ? [stylePencil(copy)]
    : [tour("duplicate-style"), roleChoices(role, env).length ? { selector: ".folders-list" } : styleItem(base)]);
};

const roleMarks = (role, env) => (roleCopyId(role, env)
  ? null
  : roleChoices(role, env).map((style) => stylePencil(style.id).selector).join(", ") || null);

// The role step passed without the guide working on it: the style marked
// for the role was already there
const roleWasThere = (role) => !session[role + "KnownIds"];

// Each step is checked from the panel state: it passes by itself when the
// user does it, in Photoshop or in the panel. The guide never does the
// gesture: `spot` rings the control to use, `fallback` is offered only when
// that control is hidden in the user's layout. env: see TourModal (tour.jsx).
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
          "…so TypeR shrank the text just enough to fit, down to 70% of the style size at most. One hyphen is allowed only as a last resort. Both can be changed in Settings > Insertion.",
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
          "Two lines, one per part, in a single history step: one Ctrl+Z undoes both. Triple bubbles work the same way. If TypeR ever puts a single line in a double bubble, click the same bubble again: it splits it and pastes the next line in the other part.",
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
            "For shout bubbles, TypeR uses the style marked “Shout” in the folder of the current style. Click the pencil of the style you want for them, other than your dialogue style. Or make one: right-click your dialogue style, then Duplicate."),
        // Editing a style already there: only its bubble type changes
        coach: (env) => (roleCopyId("shout", env)
          ? locale.whatsNewBubblesCoach3 ||
            "Set Bubble type to Shout, pick a font that shouts and another name if you like, then click Save."
          : locale.whatsNewBubblesCoach3Reuse || "Set Bubble type to Shout, then click Save."),
        // A style already marked passes: the guide does not ask for another one
        check: (env) => !!env.shoutStyle,
        spot: (env) => roleSpot("shout", env),
        marks: (env) => roleMarks("shout", env),
        result: (env) => (roleWasThere("shout") && env.shoutStyle
          ? fill(
            locale.whatsNewBubblesResult3Existing ||
              "Your style “{name}” is already marked Shout: TypeR uses it only for bubbles detected as shouts. A prefix on the script line always wins.",
            { name: env.shoutStyle.name }
          )
          : locale.whatsNewBubblesResult3 ||
            "The Shout style is used only for bubbles detected as shouts. A prefix on the script line always wins."),
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
            "Narration boxes work the same way, with the style marked “Narration”. Click the pencil of the style you want for them, or duplicate your dialogue style again."),
        coach: (env) => (roleCopyId("narration", env)
          ? locale.whatsNewBubblesCoach6 ||
            "Set Bubble type to Narration, pick the font of your captions and another name if you like, then click Save."
          : locale.whatsNewBubblesCoach6Reuse || "Set Bubble type to Narration, then click Save."),
        check: (env) => !!env.narrationStyle,
        spot: (env) => roleSpot("narration", env),
        marks: (env) => roleMarks("narration", env),
        result: (env) => (roleWasThere("narration") && env.narrationStyle
          ? fill(
            locale.whatsNewBubblesResult6Existing ||
              "Your style “{name}” is already marked Narration: TypeR uses it only for boxes detected as narration.",
            { name: env.narrationStyle.name }
          )
          : locale.whatsNewBubblesResult6 || "The Narration style is used only for boxes detected as narration."),
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
          "In Photoshop, select a text layer in the Layers panel, then click one of the suggested shapes in TypeR.",
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

/* =============================== course =============================== */

const COURSE = {
  id: "whatsNew",
  getChapters,
  art: ART,
  hero: "3.0",
  title: () => locale.whatsNewTitle || "What's new in TypeR 3.0",
  practiceTabName: () => locale.whatsNewPracticeTab || "TypeR 3.0 practice",
  completeAction: "completeWhatsNew",
  intro: {
    title: () => locale.whatsNewIntroTitle || "Welcome to TypeR 3.0",
    text: () => locale.whatsNewIntroText ||
      "A hands-on tour in Photoshop: TypeR opens a practice page and a script, and each exercise checks itself as soon as you do it. Each step unlocks the next one, and the guide moves on by itself.",
    spot: () => locale.whatsNewIntroSpot || "You do every gesture yourself: the guide highlights the button to use in the panel.",
  },
  end: {
    title: () => locale.whatsNewDoneTitle || "You are all set",
    next: { modal: "walkthrough", label: () => locale.whatsNewOpenBasics || "Basics walkthrough" },
    notes: () => [
      isUxp()
        ? locale.whatsNewDoneUxp ||
          "You are using the new TypeR (UXP): native on Apple Silicon and able to install its own updates."
        : locale.whatsNewDoneLegacy ||
          "This is the Legacy version. From Photoshop 2025, TypeR offers to switch to the new TypeR (UXP), faster and native on Apple Silicon.",
      locale.whatsNewDoneText || "Reopen this tour at any time from Help or Settings > General.",
    ],
  },
};

const WhatsNewModal = React.memo(function WhatsNewModal() {
  return <TourModal course={COURSE} />;
});

export default WhatsNewModal;
