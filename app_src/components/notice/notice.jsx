import "./notice.scss";

import React from "react";
import { FiAlertTriangle, FiInfo } from "react-icons/fi";
import { locale } from "../../utils";
import { useContext } from "../../context";

// Long enough to read a one-line message, short enough to stay out of the way.
// Warnings (smart paste fallbacks) carry a reason, so they stay a bit longer.
const INFO_DURATION_MS = 4000;
const WARNING_DURATION_MS = 6000;

// Small toast above the footer for state.notice. Absolutely positioned, so it
// never shifts the panel layout; a click dismisses it early.
const Notice = React.memo(function Notice() {
  const context = useContext((state) => ({ notice: state.notice }));
  const { dispatch } = context;
  const notice = context.state.notice;
  const noticeId = notice ? notice.id : null;
  const warning = !!notice && notice.kind === "warning";

  React.useEffect(() => {
    if (noticeId === null) return undefined;
    const timer = setTimeout(
      () => dispatch({ type: "clearNotice", id: noticeId }),
      warning ? WARNING_DURATION_MS : INFO_DURATION_MS
    );
    return () => clearTimeout(timer);
  }, [noticeId, warning, dispatch]);

  if (!notice) return null;
  const Icon = warning ? FiAlertTriangle : FiInfo;
  return (
    <div className="typer-notice">
      <div
        key={notice.id}
        className={"typer-notice__toast hostBgdLight" + (warning ? " typer-notice__toast--warning" : "")}
        role={warning ? "alert" : "status"}
        aria-live="polite"
        title={locale.close || "Close"}
        onClick={() => dispatch({ type: "clearNotice", id: notice.id })}
      >
        <Icon size={13} className="typer-notice__icon" />
        <span className="typer-notice__text">{notice.text}</span>
      </div>
    </div>
  );
});

export default Notice;
