// Loads the TextShapeR engine with its hyphenation patterns, once
let enginePromise = null;
export const loadTextShapeREngine = () => {
  if (!enginePromise) {
    enginePromise = Promise.all([
      import(/* webpackChunkName: "text-shaper-engine" */ "./textShapeR"),
      import(/* webpackChunkName: "text-shaper-patterns" */ "./textShapeRPatterns"),
    ]).then(([engine, patterns]) => {
      engine.registerTextShapeRPatterns(patterns.default);
      return engine;
    });
  }
  return enginePromise;
};
