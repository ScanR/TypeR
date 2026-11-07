// app_src/components/modal/fontFinderLogo.jsx in the panel's own DOM: the
// logo is drawn with strokes, which UXP's SVG renderer ignores (see iconsFi.js)
import React from "react";
import { RiFileSearchLine } from "react-icons/ri";

const FontFinderLogo = ({ size = 18, className = "" }) => (
  <RiFileSearchLine size={size} className={`font-finder-logo${className ? ` ${className}` : ""}`} aria-hidden="true" />
);

export default FontFinderLogo;
