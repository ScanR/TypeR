// PostCSS plugin of the stylesheet of TypeR in the panel's own DOM
// (webpack.uxp.config.js, inPanelConfig; uxp-src/host/inPanel.js):
// - The application's <button> elements are <div class="typer-button"> there
//   (uxp-src/web/inpanel/elements.js), since UXP draws a <button> as a native
//   widget that shows no icon: the rules about "button" follow them, and
//   :disabled, which only form elements match, becomes [disabled].
// - Rules about placeholders are dropped: with them, Photoshop 27.9 (UXP 9.3)
//   crashes (access violation in dynamic-torqnative.dll) a few seconds after
//   an empty <input type="number" class="topcoat-text-input--large"
//   placeholder> appears, as in the style editor (docs/uxp-webview-refused.md).
// - A field's background loses its !important: elements.js sets it opaque.
// - Every text colour also sets --typer-icon, the fill of the icons
//   (uxp-src/web/inpanel/style.scss): UXP's SVG renderer has no currentColor,
//   and a custom property inherits as the colour does.
const selectorParser = require('postcss-selector-parser');

const PLACEHOLDER = /placeholder/i;
// The last compound of a selector names a text field
const FIELD_SUBJECT = /(^|[^\w-])(input|textarea|select)(?![\w-])|text-input|topcoat-textarea/i;
const ICON_COLOR = '--typer-icon';
// Values that are no colour of their own for an icon to take
const NOT_A_COLOR = /currentcolor|^\s*(inherit|initial|unset|revert)\s*$/i;

const rewrite = selectorParser((selectors) => {
  selectors.walkTags((tag) => {
    if (tag.value.toLowerCase() === 'button') tag.replaceWith(selectorParser.className({ value: 'typer-button' }));
  });
  selectors.walkPseudos((pseudo) => {
    if (pseudo.value.toLowerCase() === ':disabled') pseudo.replaceWith(selectorParser.attribute({ attribute: 'disabled' }));
  });
});

module.exports = () => ({
  postcssPlugin: 'typer-inpanel',
  Rule(rule) {
    // Keyframe steps (from, 50%) are not selectors
    if (rule.parent && rule.parent.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;
    if (PLACEHOLDER.test(rule.selector)) {
      rule.remove();
      return;
    }
    const selector = rewrite.processSync(rule.selector);
    if (selector !== rule.selector) rule.selector = selector;
    // A field's background is set opaque at run time (elements.js): UXP paints
    // a translucent one black. Its inline style must win, and UXP lets a
    // stylesheet's !important beat an inline !important
    if (FIELD_SUBJECT.test(rule.selector) && rule.selectors.some((one) => FIELD_SUBJECT.test(one.split(/[\s>+~]+/).pop()))) {
      rule.each((node) => {
        if (node.type === 'decl' && /^background(-color)?$/i.test(node.prop) && node.important) node.important = false;
      });
    }
    let hasIconColor = false;
    rule.each((node) => { if (node.type === 'decl' && node.prop === ICON_COLOR) hasIconColor = true; });
    if (hasIconColor) return;
    rule.each((node) => {
      if (node.type !== 'decl' || node.prop.toLowerCase() !== 'color' || NOT_A_COLOR.test(node.value)) return;
      node.cloneAfter({ prop: ICON_COLOR });
    });
  },
});
module.exports.postcss = true;
