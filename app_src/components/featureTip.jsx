import "./featureTip.scss";

import React from "react";
import { FiInfo, FiX } from "react-icons/fi";

import { locale } from "../utils";
import { useContext } from "../context";
import { formatFeatureTip } from "../featureTips";
import { formatShortcut } from "../shortcutCommands";

// Long enough to read a two-line tip; hovering the toast pauses the countdown
const TIP_DURATION_MS = 20000;

const selectFeatureTipState = (state) => ({
  activeFeatureTip: state.activeFeatureTip,
  showTips: state.showTips,
  notice: state.notice,
  keepTextSizeShortcut: state.shortcut?.keepTextSize,
});

// "Did you know?" toast above the footer, in the notice toast's spot. It
// floats over the panel, so it never shifts the layout, and wraps instead of
// being cut by a narrow panel. A notice (paste feedback) takes the spot for
// its few seconds, then the tip comes back.
const FeatureTip = React.memo(function FeatureTip() {
  const context = useContext(selectFeatureTipState);
  const { dispatch } = context;
  const id = context.state.activeFeatureTip;
  const [hovered, setHovered] = React.useState(false);
  // A toast closed under the mouse never gets its mouseleave
  React.useEffect(() => setHovered(false), [id]);

  React.useEffect(() => {
    if (!id || hovered) return undefined;
    const timer = setTimeout(() => dispatch({ type: "hideFeatureTip", id }), TIP_DURATION_MS);
    return () => clearTimeout(timer);
  }, [id, hovered, dispatch]);

  if (!id || context.state.showTips === false || context.state.notice) return null;
  return (
    <div className="feature-tip">
      <div
        key={id}
        className="feature-tip__toast hostBgdLight"
        role="status"
        aria-live="polite"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <FiInfo size={13} className="feature-tip__icon" />
        <span className="feature-tip__text">
          <strong>{locale.featureTipTitle || "Did you know?"}</strong>{" "}
          {formatFeatureTip(id, locale, {
            keepSize: formatShortcut(context.state.keepTextSizeShortcut),
          })}
        </span>
        <button
          type="button"
          className="feature-tip__close"
          title={locale.close || "Close"}
          aria-label={locale.close || "Close"}
          onClick={() => dispatch({ type: "hideFeatureTip", id })}
        >
          <FiX size={13} />
        </button>
      </div>
    </div>
  );
});

export default FeatureTip;
