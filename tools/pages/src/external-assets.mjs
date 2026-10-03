// Finds third-party assets in an HTML document (docs/security.md, P1).
// Shared by assemble.mjs (the whole Pages artifact) and
// .github/scripts/code-map.mjs (graphify's page).
//
// The HTML is parsed (jsdom, no scripts executed) and each URL is resolved
// with the WHATWG URL parser, the same code a browser uses. A regex over the
// source misses legal HTML: spaces around `=`, unquoted values, entities
// (`&#x2F;&#x2F;host`), `\\host`, tabs inside the URL, and `<template>` content.
// The check is fail-closed: a URL that does not parse counts as third-party.
import { JSDOM } from 'jsdom';

/** [element, attribute] pairs where the browser fetches (or re-bases) a URL. */
const LOADERS = [
  ['script', 'src'],
  ['link', 'href'],
  ['base', 'href'],
];

// Any host that is not a real one: relative URLs resolve onto it, so a URL
// whose origin differs from it left the site. `data:` has no host to contact.
const SITE = 'http://pages.invalid';

function isThirdParty(value) {
  let url;
  try {
    url = new URL(value, `${SITE}/`);
  } catch {
    return true;
  }
  return url.origin !== SITE && url.protocol !== 'data:';
}

/** The raw attribute values of every third-party script, stylesheet/link and <base>. */
export function findExternalAssets(html) {
  const { window } = new JSDOM(html);
  const found = [];
  const scan = (root) => {
    for (const [tag, attribute] of LOADERS) {
      for (const element of root.querySelectorAll(`${tag}[${attribute}]`)) {
        const value = element.getAttribute(attribute);
        if (isThirdParty(value)) found.push(value);
      }
    }
    // querySelectorAll does not look inside <template> content.
    for (const template of root.querySelectorAll('template')) {
      scan(template.content);
    }
  };
  scan(window.document);
  window.close();
  return found;
}
