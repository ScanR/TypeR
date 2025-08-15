import "./main.scss";

import React from "react";
import { readStorage, writeToStorage, resizeTextArea } from "../../utils";
import Modal from "../modal/modal";
import TextBlock from "../textBlock/textBlock";
import PreviewBlock from "../previewBlock/previewBlock";
import StylesBlock from "../stylesBlock/stylesBlock";
import AppFooter from "../footer/footer";

const topHeight = 130;
const minMiddleHeight = 100;
const minBottomHeight = 70;

const ResizeableCont = React.memo(function ResizeableCont() {
  const appBlock = React.useRef();
  const bottomBlock = React.useRef();
  const draggingRef = React.useRef(false);
  const resizeStartYRef = React.useRef(0);
  const resizeStartHRef = React.useRef(0);
  const bottomHeightRef = React.useRef(0);
  const appHeightRef = React.useRef(0);

  const startBottomResize = (e) => {
    resizeStartHRef.current = bottomBlock.current.offsetHeight;
    resizeStartYRef.current = e.pageY;
    draggingRef.current = true;
  };

  const stopBottomResize = () => {
    if (draggingRef.current) {
      writeToStorage({ bottomHeight: bottomHeightRef.current });
      draggingRef.current = false;
    }
  };

  const moveBottomResize = (e) => {
    if (draggingRef.current) {
      e.preventDefault();
      const dy = e.pageY - resizeStartYRef.current;
      const newHeight = resizeStartHRef.current - dy;
      setBottomSize(newHeight);
    }
  };

  const setBottomSize = (height) => {
    const maxBottomHeight = appHeightRef.current - (appHeightRef.current > 450 ? topHeight : 0) - minMiddleHeight;
    bottomHeightRef.current = height || readStorage("bottomHeight") || minBottomHeight;
    if (height < minBottomHeight) bottomHeightRef.current = minBottomHeight;
    if (height > maxBottomHeight) bottomHeightRef.current = maxBottomHeight;
    bottomBlock.current.style.height = bottomHeightRef.current + "px";
    resizeTextArea();
  };

  const setAppSize = () => {
    appHeightRef.current = document.documentElement.clientHeight;
    appBlock.current.style.height = appHeightRef.current + "px";
    setBottomSize();
  };

  React.useEffect(() => {
    window.addEventListener("resize", setAppSize);
    setAppSize();
    
    return () => {
      window.removeEventListener("resize", setAppSize);
    };
  }, []);

  return (
    <div className="app-body" ref={appBlock} onMouseMove={moveBottomResize} onMouseLeave={stopBottomResize} onMouseUp={stopBottomResize}>
      <Modal />
      <div className="top-block preview-block" style={{ height: topHeight }}>
        <PreviewBlock />
      </div>
      <div className="top-divider hostBgdDark"></div>
      <div className="middle-block text-block">
        <TextBlock />
      </div>
      <div className="middle-divider hostBgdDark" onMouseDown={startBottomResize}>
        <div className="hostBgdLight"></div>
      </div>
      <div className="bottom-block styles-block" ref={bottomBlock}>
        <StylesBlock />
      </div>
      <div className="footer-block hostBrdTopContrast">
        <AppFooter />
      </div>
    </div>
  );
});

export default ResizeableCont;
