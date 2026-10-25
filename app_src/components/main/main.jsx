import "./main.scss";

import React from "react";
import { readStorage, writeToStorage, resizeTextArea } from "../../utils";
import { useContext } from "../../context";
import Modal from "../modal/modal";
import TextBlock from "../textBlock/textBlock";
import TabBar from "../tabBar/tabBar";
import PreviewBlock from "../previewBlock/previewBlock";
import StylesBlock from "../stylesBlock/stylesBlock";
import AppFooter from "../footer/footer";
import PasteOnClick from "../../pasteOnClick";

const minMiddleHeight = 100;
const minBottomHeight = 70;
const minPreviewHeight = 80;
const maxPreviewHeight = 300;

// Clamp the requested (or stored) text block height to the window. The stored
// height must be clamped too, otherwise a height saved in a taller window can
// push the middle block to zero after a restart.
export const resolveBottomHeight = (requested, stored, maxBottomHeight) => {
  let value = Number(requested || stored) || minBottomHeight;
  if (value < minBottomHeight) value = minBottomHeight;
  if (value > maxBottomHeight) value = maxBottomHeight;
  return value;
};

const ResizeableCont = React.memo(function ResizeableCont() {
  const context = useContext((state) => ({ uiLayout: state.uiLayout }));
  const uiLayout = context.state.uiLayout;
  const { order, visible, sizes } = uiLayout;
  const appBlock = React.useRef();
  const topBlock = React.useRef();
  const bottomBlock = React.useRef();
  const topDraggingRef = React.useRef(false);
  const draggingRef = React.useRef(false);
  const topResizeStartYRef = React.useRef(0);
  const topResizeStartHRef = React.useRef(0);
  const topHeightRef = React.useRef(sizes.previewHeight);
  const resizeStartYRef = React.useRef(0);
  const resizeStartHRef = React.useRef(0);
  const bottomHeightRef = React.useRef(0);
  const appHeightRef = React.useRef(0);

  const topHeight = visible.preview ? sizes.previewHeight : 0;
  // When the styles block sits above the text block, dragging the divider
  // down must grow it instead of shrinking it
  const stylesBelowText = order.indexOf("styles") > order.indexOf("text");

  const startTopResize = (e) => {
    if (!topBlock.current || document.documentElement.clientHeight <= 450) return;
    e.preventDefault();
    topResizeStartHRef.current = topBlock.current.offsetHeight;
    topResizeStartYRef.current = e.pageY;
    topDraggingRef.current = true;
    appBlock.current?.classList.add("is-resizing");
  };

  const startBottomResize = (e) => {
    if (!bottomBlock.current) return;
    resizeStartHRef.current = bottomBlock.current.offsetHeight;
    resizeStartYRef.current = e.pageY;
    draggingRef.current = true;
    appBlock.current?.classList.add("is-resizing");
  };

  const stopTopResize = () => {
    if (!topDraggingRef.current) return;
    topDraggingRef.current = false;
    appBlock.current?.classList.remove("is-resizing");
    context.dispatch({
      type: "setUiLayout",
      layout: {
        ...uiLayout,
        sizes: {
          ...sizes,
          previewHeight: topHeightRef.current,
        },
      },
    });
  };

  const stopBottomResize = () => {
    if (draggingRef.current) {
      writeToStorage({ bottomHeight: bottomHeightRef.current });
      draggingRef.current = false;
      appBlock.current?.classList.remove("is-resizing");
    }
  };

  const setTopSize = (height) => {
    if (!topBlock.current || !visible.preview) return;
    const requestedHeight = height ?? sizes.previewHeight;
    const bottomHeight = visible.styles && visible.text && bottomBlock.current
      ? bottomBlock.current.offsetHeight
      : 0;
    const availableHeight = appHeightRef.current - bottomHeight - minMiddleHeight;
    const upperBound = Math.max(minPreviewHeight, Math.min(maxPreviewHeight, availableHeight));
    topHeightRef.current = Math.min(upperBound, Math.max(minPreviewHeight, requestedHeight));
    topBlock.current.style.height = topHeightRef.current + "px";
    resizeTextArea(!!height);
  };

  const moveTopResize = (e) => {
    if (!topDraggingRef.current) return;
    e.preventDefault();
    const dy = e.pageY - topResizeStartYRef.current;
    setTopSize(topResizeStartHRef.current + dy);
  };

  const moveBottomResize = (e) => {
    if (draggingRef.current) {
      e.preventDefault();
      const dy = e.pageY - resizeStartYRef.current;
      const newHeight = resizeStartHRef.current + (stylesBelowText ? -dy : dy);
      setBottomSize(newHeight);
    }
  };

  const setBottomSize = (height) => {
    if (!bottomBlock.current) return;
    if (!visible.text) {
      // Styles block takes the remaining space when the text block is hidden
      bottomBlock.current.style.height = "";
      return;
    }
    const maxBottomHeight = appHeightRef.current - (appHeightRef.current > 450 ? topHeight : 0) - minMiddleHeight;
    bottomHeightRef.current = resolveBottomHeight(height, readStorage("bottomHeight"), maxBottomHeight);
    bottomBlock.current.style.height = bottomHeightRef.current + "px";
    resizeTextArea(!!height);
  };

  const setAppSize = () => {
    appHeightRef.current = document.documentElement.clientHeight;
    appBlock.current.style.height = appHeightRef.current + "px";
    setTopSize();
    setBottomSize();
  };

  React.useEffect(() => {
    window.addEventListener("resize", setAppSize);
    setAppSize();

    return () => {
      window.removeEventListener("resize", setAppSize);
    };
  }, [visible.preview, visible.text, visible.styles, sizes.previewHeight]);

  // Global interface scale (zoom keeps layout math in CSS pixels)
  React.useEffect(() => {
    const scale = (sizes.uiScale || 100) / 100;
    document.documentElement.style.zoom = scale === 1 ? "" : String(scale);
    window.dispatchEvent(new Event("resize"));
  }, [sizes.uiScale]);

  const divider = visible.text ? (
    <div className="middle-divider" onMouseDown={startBottomResize}>
      <div></div>
    </div>
  ) : null;

  const blocks = {
    preview: visible.preview ? (
      <React.Fragment key="preview">
        <div className="top-block preview-block" ref={topBlock} style={{ height: topHeight }}>
          <PreviewBlock />
        </div>
        <div className="top-divider" onMouseDown={startTopResize}>
          <div></div>
        </div>
      </React.Fragment>
    ) : null,
    text: visible.text ? (
      <React.Fragment key="text">
        {visible.tabBar !== false && <TabBar />}
        <div className="middle-block text-block">
          <TextBlock />
        </div>
      </React.Fragment>
    ) : null,
    styles: visible.styles ? (
      <React.Fragment key="styles">
        {stylesBelowText && divider}
        <div className={"bottom-block styles-block" + (visible.text ? "" : " m-grow")} ref={bottomBlock}>
          <StylesBlock />
        </div>
        {!stylesBelowText && divider}
      </React.Fragment>
    ) : null,
  };

  return (
    <div
      className="app-body"
      ref={appBlock}
      onMouseMove={(e) => {
        moveTopResize(e);
        moveBottomResize(e);
      }}
      onMouseLeave={() => {
        stopTopResize();
        stopBottomResize();
      }}
      onMouseUp={() => {
        stopTopResize();
        stopBottomResize();
      }}
    >
      <Modal />
      <PasteOnClick />
      {order.map((id) => blocks[id])}
      <div className="footer-block hostBrdTopContrast">
        <AppFooter />
      </div>
    </div>
  );
});

export default ResizeableCont;
