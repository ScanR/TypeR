import React from "react";
import PropTypes from "prop-types";

import { locale } from "../../utils";
import { splitHighlights } from "../../settingsSearch";

const Highlighted = ({ text, terms }) => (
  <React.Fragment>
    {splitHighlights(text, terms).map((piece, index) => (piece.match ? <mark key={index}>{piece.text}</mark> : piece.text))}
  </React.Fragment>
);

Highlighted.propTypes = {
  text: PropTypes.string,
  terms: PropTypes.arrayOf(PropTypes.string),
};

// Takes the place of the tab content while a search is typed: a click opens
// the setting in its tab
const SettingsSearchResults = React.memo(function SettingsSearchResults({ query, results, highlight, onOpen, onHighlight }) {
  const activeRef = React.useRef(null);
  const movedByMouse = React.useRef(false);

  // Follows the arrow keys; a row under the pointer stays where it is
  React.useEffect(() => {
    if (!movedByMouse.current && activeRef.current) activeRef.current.scrollIntoView({ block: "nearest" });
    movedByMouse.current = false;
  }, [highlight]);

  if (!results.length) {
    return (
      <div className="settings-search-empty">
        {locale.settingsSearchNoResults.replace("{query}", query.trim())}
      </div>
    );
  }
  return (
    <div className="settings-search-results">
      {results.map((result, index) => (
        <button
          type="button"
          key={result.entry.id}
          ref={index === highlight ? activeRef : null}
          className={"settings-search-result" + (index === highlight ? " m-active" : "")}
          onClick={() => onOpen(result.entry)}
          onMouseMove={() => {
            if (index === highlight) return;
            movedByMouse.current = true;
            onHighlight(index);
          }}
        >
          {result.entry.crumbs.length > 0 && (
            <span className="settings-search-result-path">{result.entry.crumbs.join(" › ")}</span>
          )}
          <span className="settings-search-result-title">
            <Highlighted text={result.entry.title} terms={result.terms} />
          </span>
          {result.entry.hint && (
            <span className="settings-search-result-hint">
              <Highlighted text={result.entry.hint} terms={result.terms} />
            </span>
          )}
        </button>
      ))}
    </div>
  );
});

SettingsSearchResults.propTypes = {
  query: PropTypes.string.isRequired,
  results: PropTypes.array.isRequired,
  highlight: PropTypes.number.isRequired,
  onOpen: PropTypes.func.isRequired,
  onHighlight: PropTypes.func.isRequired,
};

export default SettingsSearchResults;
