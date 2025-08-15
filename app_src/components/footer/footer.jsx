import "./footer.scss";

import React from "react";
import PropTypes from "prop-types";
import { locale } from "../../utils";
import { useContext } from "../../context";
import HiddenFileInput from "../hiddenFileInput/hiddenFileInput";

const AppFooter = React.memo(function AppFooter() {
  const context = useContext();
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

  const openRepository = () => {
    if (context.state.images.length) {
      context.dispatch({ type: "setImages", images: [] });
      return;
    }
    fileInputRef.current?.click();
  };

  return (
    <React.Fragment>
      <span className="link" onClick={openHelp}>
        {locale.footerHelp}
      </span>
      <span className="link" onClick={openSettings}>
        {locale.footerSettings}
      </span>
      <span className="link" onClick={openRepository}>
        {context.state.images.length
          ? locale.footerDesyncRepo
          : locale.footerOpenRepo}
      </span>
      <HiddenFileInput ref={fileInputRef} />
    </React.Fragment>
  );
});

export default AppFooter;
