import React from "react";
import { useContext } from "../../context";

// Photoshop opens WebP natively from 23.2. The UXP plugin needs 26.0, the CEP
// panel still runs on older versions that would fail to open it.
const allowedTypes = () => {
  const types = [".psd", ".png", ".jpg", ".jpeg"];
  if (typeof window !== "undefined" && window.typerUXP) types.push(".webp");
  return types;
};

export default React.forwardRef(function HiddenFileInput(props, ref) {
  const context = useContext(() => ({}));
  const allowed = allowedTypes();

  const onChange = (e) => {
    const files = Array.from(e.target.files || []).filter((f) =>
      allowed.includes("." + f.name.split(".").pop().toLowerCase())
    );
    if (!files.length) return;

    const images = files
      .map((f) => {
        const baseName = f.name.replace(/\.[^.]+$/, "");
        return { name: f.name, baseName, path: f.path || f.name };
      })
      .sort((a, b) =>
        a.baseName.localeCompare(b.baseName, undefined, {
          numeric: true,
          sensitivity: "base",
        })
      );

    context.dispatch({ type: "setImages", images });
    e.target.value = "";
  };

  return (
    <input
      ref={ref}
      {...props}
      type="file"
      accept={allowed.join(",")}
      multiple
      style={{ display: "none" }}
      onChange={onChange}
    />
  );
});
