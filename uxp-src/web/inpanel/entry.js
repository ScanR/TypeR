// Entry of the application in the panel's own DOM (webpack.uxp.config.js,
// inPanelConfig): the WebView entry, with the stylesheet for UXP's layout
// engine and the elements UXP would draw as native widgets
import "./style.scss";
import { installInPanelElements } from "./elements";
import "../entry";

// Before the application renders: it starts once the host answered init
installInPanelElements();
