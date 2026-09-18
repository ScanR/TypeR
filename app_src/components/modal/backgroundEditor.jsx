import React from "react";
import { FiImage, FiTrash2, FiX } from "react-icons/fi";

import { locale } from "../../utils";
import { clamp01 } from "../../themeColors";
import { computeBackgroundLayout } from "../../backgroundImage";

const PREVIEW_HEIGHT = 170;

// Inline editor of the "Custom image" theme: pick a picture, frame it, and
// tune how much of it shows through the interface.
const BackgroundEditor = React.memo(function BackgroundEditor(props) {
  const { image, data, busy, onImport, onChange, onRemove, onClose } = props;
  const previewRef = React.useRef(null);
  const stateRef = React.useRef(image);
  const [box, setBox] = React.useState({ width: 0, height: PREVIEW_HEIGHT });
  const [dragging, setDragging] = React.useState(false);

  const stopDragRef = React.useRef(null);

  stateRef.current = image;

  // Closing the editor mid-drag must not leave window listeners behind
  React.useEffect(() => () => {
    if (stopDragRef.current) stopDragRef.current();
  }, []);

  React.useEffect(() => {
    const measure = () => {
      const node = previewRef.current;
      if (!node) return;
      setBox({ width: node.clientWidth, height: node.clientHeight });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [data]);

  const layout = image && data && box.width
    ? computeBackgroundLayout(box.width, box.height, image.width, image.height, image.crop)
    : null;

  const patch = (values) => onChange({ ...stateRef.current, ...values });
  const patchCrop = (values) => patch({ crop: { ...stateRef.current.crop, ...values } });
  const changeNumber = (key, transform) => (e) => {
    const value = parseFloat(e.target.value);
    patch({ [key]: transform ? transform(value) : value });
  };

  const startDrag = (e) => {
    if (!layout || (!layout.maxOffsetX && !layout.maxOffsetY)) return;
    e.preventDefault();
    const start = {
      x: e.clientX,
      y: e.clientY,
      cropX: image.crop.x,
      cropY: image.crop.y,
      maxX: layout.maxOffsetX,
      maxY: layout.maxOffsetY,
    };
    setDragging(true);

    const move = (event) => {
      const crop = {};
      // The picture follows the pointer: moving right shows more of its left side
      if (start.maxX) crop.x = clamp01(start.cropX - (event.clientX - start.x) / start.maxX);
      if (start.maxY) crop.y = clamp01(start.cropY - (event.clientY - start.y) / start.maxY);
      patchCrop(crop);
    };
    const stop = () => {
      stopDragRef.current = null;
      setDragging(false);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
    };
    if (stopDragRef.current) stopDragRef.current();
    stopDragRef.current = stop;
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
  };

  const renderSlider = (label, value, min, max, step, onSliderChange, display) => (
    <div className="settings-bg-slider">
      <div className="settings-bg-slider-head">
        <span>{label}</span>
        <b>{display}</b>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={onSliderChange} />
    </div>
  );

  return (
    <div className="settings-bg-editor">
      <div className="settings-bg-editor-head">
        <span className="settings-bg-editor-title">{locale.settingsBackgroundTitle || "Background image"}</span>
        <button type="button" className="topcoat-button--large" onClick={onImport} disabled={busy}>
          <FiImage size={13} />
          <span>{image ? locale.settingsBackgroundReplace || "Replace image" : locale.settingsBackgroundChoose || "Choose an image"}</span>
        </button>
        <button type="button" className="settings-theme-editor-close" onClick={onClose} title={locale.close || "Close"}>
          <FiX size={16} />
        </button>
      </div>

      {!image || !data ? (
        <div className="settings-bg-empty">{locale.settingsBackgroundEmpty || "No image selected yet."}</div>
      ) : (
        <React.Fragment>
          <div
            ref={previewRef}
            className={"settings-bg-preview" + (dragging ? " m-dragging" : "")}
            style={{ height: PREVIEW_HEIGHT }}
            onMouseDown={startDrag}
            title={locale.settingsBackgroundDragHint || "Drag to reframe"}
          >
            <div
              className="settings-bg-preview-image"
              style={{
                backgroundImage: `url("${data}")`,
                backgroundSize: layout ? layout.backgroundSize : "cover",
                backgroundPosition: layout ? layout.backgroundPosition : "center",
                opacity: image.opacity,
                filter: image.blur ? `blur(${image.blur}px)` : "none",
              }}
            />
            <div
              className="settings-bg-preview-tint"
              style={{
                backgroundColor: image.mode === "light" ? "#ffffff" : "#1e1e1e",
                opacity: image.tint,
              }}
            />
            <div className="settings-bg-preview-mock">
              <span className="m-bar" />
              <span className="m-line" />
              <span className="m-line m-short" />
            </div>
          </div>

          <div className="settings-bg-controls">
            {renderSlider(
              locale.settingsBackgroundZoom || "Zoom",
              image.crop.zoom,
              1,
              4,
              0.01,
              (e) => patchCrop({ zoom: parseFloat(e.target.value) }),
              Math.round(image.crop.zoom * 100) + "%"
            )}
            {renderSlider(
              locale.settingsBackgroundOpacity || "Image opacity",
              image.opacity,
              0.05,
              1,
              0.01,
              changeNumber("opacity"),
              Math.round(image.opacity * 100) + "%"
            )}
            {renderSlider(
              locale.settingsBackgroundTint || "Interface tint",
              image.tint,
              0,
              0.95,
              0.01,
              changeNumber("tint"),
              Math.round(image.tint * 100) + "%"
            )}
            {renderSlider(
              locale.settingsBackgroundBlur || "Blur",
              image.blur,
              0,
              24,
              1,
              changeNumber("blur"),
              Math.round(image.blur) + " px"
            )}
          </div>

          <div className="settings-bg-foot">
            <div className="settings-theme-editor-modes">
              {["dark", "light"].map((mode) => (
                <button
                  type="button"
                  key={mode}
                  className={"topcoat-button--large" + (image.mode === mode ? " m-active" : "")}
                  onClick={() => patch({ mode })}
                >
                  {mode === "dark"
                    ? locale.settingsThemeModeDark || "Dark"
                    : locale.settingsThemeModeLight || "Light"}
                </button>
              ))}
            </div>
            <span className="settings-bg-name">{image.name}</span>
            <button type="button" className="topcoat-button--large m-danger" onClick={onRemove}>
              <FiTrash2 size={13} />
              <span>{locale.settingsBackgroundRemove || "Remove image"}</span>
            </button>
          </div>
        </React.Fragment>
      )}
    </div>
  );
});

export default BackgroundEditor;
