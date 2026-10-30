// A style's stroke can be switched off with a shortcut: it keeps its size and
// color, and the host skips it while enabled is false.

const DEFAULT_SIZE = 3;

export const isStyleStrokeOn = (style) => {
  const stroke = style && style.stroke;
  return !!stroke && stroke.enabled !== false && stroke.size > 0;
};

// A style that never had a stroke gets a default one, so the shortcut always works
export const toggleStyleStroke = (style) => {
  const stroke = style.stroke || {};
  if (!(stroke.size > 0)) {
    return {
      ...style,
      stroke: { opacity: 100, position: "outer", color: { r: 255, g: 255, b: 255 }, ...stroke, enabled: true, size: DEFAULT_SIZE },
    };
  }
  return { ...style, stroke: { ...stroke, enabled: !isStyleStrokeOn(style) } };
};
