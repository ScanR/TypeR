import React from "react";
import PropTypes from "prop-types";
import { useContext } from "../../context";

const allowed = ".psd,.png,.jpg,.jpeg";

export default React.forwardRef(function HiddenFileInput(_, ref) {
  const context = useContext();

  const onChange = (e) => {
    const files = Array.from(e.target.files || []).filter((f) =>
      allowed
        .split(",")
        .includes("." + f.name.split(".").pop().toLowerCase())
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
      type="file"
      accept={allowed}
      multiple
      style={{ display: "none" }}
      onChange={onChange}
    />
  );
});
