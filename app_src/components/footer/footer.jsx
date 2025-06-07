import "./footer.scss";

import React from "react";
import { locale, openFile } from "../../utils";
import { useContext } from "../../context";

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
  const openRepository = () => {
    if (context.state.images.length) {
      context.dispatch({ type: "setImages", images: [] });
      return;
    }
    const extension = ["psd", "png", "jpg", "jpeg"];
    const result = window.cep.fs.showOpenDialogEx(true, false, "Open Images", "", extension);
    if (result.err == 0) {
      const images = result.data
        .map((url) => {
          const name = url.split(/\/|\\/).pop();
          const extName = name.split(/\./).pop();
          const baseName = name.substring(0, name.length - extName.length - 1);
          return { name: name, baseName: baseName, path: url };
        })
        .sort((a, b) => a.baseName.localeCompare(b.baseName));
      context.dispatch({
        type: "setImages",
        images: images,
      });
    } else {
      console.log(result.err);
    }
  };

  return (
    <React.Fragment>
      <span className="link" onClick={openHelp}>
        {locale.footerHelp}
      </span>
      <span className="link footer-settings" onClick={openSettings}>
        {locale.footerSettings}
      </span>
      <span className="link" onClick={openRepository}>
        {context.state.images.length
          ? locale.footerDesyncRepo
          : locale.footerOpenRepo}
      </span>
    </React.Fragment>
  );
});

export default AppFooter;
