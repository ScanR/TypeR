import React from "react";

const OFFSET = 8;
const SHOW_DELAY = 300;

const getTooltipTarget = (node) => {
  if (!node || node === document || node === window) return null;
  if (typeof node.closest !== "function") return null;
  const target = node.closest("[title], [data-tooltip]");
  if (!target || !document.body.contains(target)) return null;
  const text = target.getAttribute("data-tooltip") || target.getAttribute("title") || target.getAttribute("data-typer-title") || "";
  return text.trim() ? target : null;
};

const getTooltipText = (target) => {
  if (!target) return "";
  return (target.getAttribute("data-tooltip") || target.getAttribute("title") || target.getAttribute("data-typer-title") || "").trim();
};

const placeTooltip = (target, tooltipWidth, tooltipHeight) => {
  const rect = target.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const left = Math.min(
    Math.max(6, rect.left + rect.width / 2 - tooltipWidth / 2),
    Math.max(6, viewportWidth - tooltipWidth - 6)
  );
  let top = rect.bottom + OFFSET;
  if (top + tooltipHeight + 6 > viewportHeight) {
    top = rect.top - tooltipHeight - OFFSET;
  }
  return {
    left,
    top: Math.max(6, top),
  };
};

const GlobalTooltip = React.memo(function GlobalTooltip() {
  const [tooltip, setTooltip] = React.useState(null);
  const tooltipRef = React.useRef(null);
  const targetRef = React.useRef(null);
  const frameRef = React.useRef(null);
  const showTimerRef = React.useRef(null);

  const restoreNativeTitle = React.useCallback((target) => {
    if (!target) return;
    const storedTitle = target.getAttribute("data-typer-title");
    if (storedTitle !== null) {
      target.setAttribute("title", storedTitle);
      target.removeAttribute("data-typer-title");
    }
  }, []);

  const hide = React.useCallback(() => {
    if (showTimerRef.current) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (frameRef.current) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    restoreNativeTitle(targetRef.current);
    targetRef.current = null;
    setTooltip(null);
  }, [restoreNativeTitle]);

  const schedulePosition = React.useCallback((target, text) => {
    if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const node = tooltipRef.current;
      if (!node || !targetRef.current) return;
      const box = node.getBoundingClientRect();
      setTooltip({
        text,
        ...placeTooltip(target, box.width, box.height),
        visible: true,
      });
    });
  }, []);

  const show = React.useCallback((target) => {
    const text = getTooltipText(target);
    if (!text) return;
    if (targetRef.current && targetRef.current !== target) {
      restoreNativeTitle(targetRef.current);
    }
    targetRef.current = target;
    if (target.getAttribute("title") !== null) {
      target.setAttribute("data-typer-title", target.getAttribute("title") || "");
      target.removeAttribute("title");
    }
    if (showTimerRef.current) window.clearTimeout(showTimerRef.current);
    showTimerRef.current = window.setTimeout(() => {
      showTimerRef.current = null;
      if (targetRef.current !== target) return;
      setTooltip({ text, left: 0, top: 0, visible: false });
      schedulePosition(target, text);
    }, SHOW_DELAY);
  }, [restoreNativeTitle, schedulePosition]);

  React.useEffect(() => {
    const handleMouseOver = (event) => {
      const target = getTooltipTarget(event.target);
      if (!target || target === targetRef.current) return;
      show(target);
    };
    const handleMouseOut = (event) => {
      const current = targetRef.current;
      if (!current) return;
      const next = event.relatedTarget;
      if (next && current.contains(next)) return;
      hide();
    };
    const handleFocus = (event) => {
      const target = getTooltipTarget(event.target);
      if (target) show(target);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") hide();
    };

    document.addEventListener("mouseover", handleMouseOver, true);
    document.addEventListener("mouseout", handleMouseOut, true);
    document.addEventListener("focusin", handleFocus, true);
    document.addEventListener("focusout", hide, true);
    window.addEventListener("blur", hide);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      const currentTarget = targetRef.current;
      document.removeEventListener("mouseover", handleMouseOver, true);
      document.removeEventListener("mouseout", handleMouseOut, true);
      document.removeEventListener("focusin", handleFocus, true);
      document.removeEventListener("focusout", hide, true);
      window.removeEventListener("blur", hide);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      document.removeEventListener("keydown", handleKeyDown);
      if (showTimerRef.current) window.clearTimeout(showTimerRef.current);
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
      restoreNativeTitle(currentTarget);
    };
  }, [hide, restoreNativeTitle, show]);

  if (!tooltip) return null;
  return (
    <div
      ref={tooltipRef}
      className={"global-tooltip" + (tooltip.visible ? " is-visible" : "")}
      style={{ left: tooltip.left, top: tooltip.top }}
    >
      {tooltip.text}
    </div>
  );
});

export default GlobalTooltip;
