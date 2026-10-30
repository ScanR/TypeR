import "./fontFinderSuggestion.scss";

import React from "react";
import PropTypes from "prop-types";
import { FiCheck, FiDownload, FiLoader } from "react-icons/fi";
import { FaGoogle } from "react-icons/fa";

import { locale, openUrl } from "../../utils";
import { getFontWebSearchUrl } from "../../fontFinderMatch";
import FontFinderLogo from "./fontFinderLogo";

// Font FindeR status of one missing font: nothing while unknown or not found,
// an install button when a match exists.
const FontFinderSuggestion = React.memo(function FontFinderSuggestion({ entry, busy, onInstall }) {
  if (!entry) return null;
  if (entry.state === "searching") {
    return (
      <span className="ffs-chip m-searching" title={locale.fontFinderSearching}>
        <FiLoader size={10} className="ffs-spin" /> Font FindeR
      </span>
    );
  }
  if (!entry.match) return null;
  const family = entry.match.family.family;
  if (entry.state === "installing") {
    return (
      <span className="ffs-chip m-installing">
        <FiLoader size={10} className="ffs-spin" /> {locale.fontFinderInstalling}
      </span>
    );
  }
  if (entry.state === "installed") {
    return (
      <span className="ffs-chip m-installed" title={locale.fontFinderInstalledHint.replace("{family}", family)}>
        <FiCheck size={10} /> {family}
      </span>
    );
  }
  if (entry.state !== "found") return null;
  const exact = entry.match.exact;
  const title = entry.failed
    ? locale.fontViewerInstallError
    : (exact ? locale.fontFinderInstallHint : locale.fontFinderSimilarHint).replace("{family}", family);
  return (
    <button
      type="button"
      className={`ffs-chip ffs-install${exact ? "" : " m-similar"}${entry.failed ? " m-failed" : ""}`}
      title={title}
      disabled={busy}
      onClick={(event) => {
        event.stopPropagation();
        onInstall();
      }}
    >
      <FontFinderLogo size={11} />
      <span className="ffs-label">{exact ? locale.fontFinderInstall : locale.fontFinderSimilar}</span>
      <b>{family}</b>
      <FiDownload size={10} />
    </button>
  );
});
FontFinderSuggestion.propTypes = {
  entry: PropTypes.object,
  busy: PropTypes.bool,
  onInstall: PropTypes.func.isRequired,
};

// "N missing fonts are on Font FindeR" with a single install button
const FontFinderBanner = React.memo(function FontFinderBanner({ count, busy, onInstallAll }) {
  if (!count) return null;
  return (
    <div className="ffs-banner">
      <FontFinderLogo size={16} />
      <span className="ffs-banner-text">{locale.fontFinderAvailable.replace("{count}", count)}</span>
      <button type="button" className="topcoat-button--quiet ffs-banner-btn" disabled={busy} onClick={onInstallAll}>
        {busy ? <FiLoader size={12} className="ffs-spin" /> : <FiDownload size={12} />}
        {locale.fontFinderInstallAll}
      </button>
    </div>
  );
});
FontFinderBanner.propTypes = {
  count: PropTypes.number.isRequired,
  busy: PropTypes.bool,
  onInstallAll: PropTypes.func.isRequired,
};

// Opens a Google search for a font Font FindeR does not have
const FontWebSearchButton = React.memo(function FontWebSearchButton({ fontName, postScriptName }) {
  const name = fontName || postScriptName;
  return (
    <button
      type="button"
      className="ffs-web-search"
      title={locale.fontFinderWebSearchHint.replace("{font}", name)}
      aria-label={locale.fontFinderWebSearchHint.replace("{font}", name)}
      onClick={(event) => {
        event.stopPropagation();
        openUrl(getFontWebSearchUrl({ fontName, postScriptName }));
      }}
    >
      <FaGoogle size={12} />
    </button>
  );
});
FontWebSearchButton.propTypes = {
  fontName: PropTypes.string,
  postScriptName: PropTypes.string,
};

export { FontFinderBanner, FontFinderSuggestion, FontWebSearchButton };
