// DESIGN.md 6.2: every button on the site goes through Button or IconButton in web/src/ui, so a
// new button gets the same look, focus ring, saving state and touch size without extra work.
const USE_BUTTON = 'Use Button or IconButton from web/src/ui (DESIGN.md 6.2), not a raw button.';

/** The `no-restricted-syntax` entries that catch a button built by hand in the React site. */
export const buttonRestrictions = [
  { selector: "JSXOpeningElement[name.name='button']", message: USE_BUTTON },
  {
    selector:
      "JSXOpeningElement[name.name='input'] > JSXAttribute[name.name='type'][value.value=/^(button|submit|reset)$/]",
    message: USE_BUTTON,
  },
  {
    selector: "JSXAttribute[name.name='role'][value.value='button']",
    message: USE_BUTTON,
  },
  {
    selector:
      "JSXElement[openingElement.name.name='Button'] > JSXElement[openingElement.name.name='Icon']",
    message: 'Give Button an icon through its icon prop; an icon alone is an IconButton.',
  },
] as const;

/** The only files that may render a native <button>: the shared component itself. */
export const buttonOwners = ['web/src/ui/button.tsx'];
