// Finds third-party assets in an HTML document (docs/security.md, P1).
// Shared by assemble.mjs (the whole Pages artifact) and
// .github/scripts/code-map.mjs (graphify's page).
//
// The HTML is parsed (jsdom, no scripts executed) and each URL is resolved
// as a browser would read it. A regex over the source misses legal HTML: spaces
// around `=`, unquoted values, entities (`&#x2F;&#x2F;host`), `\\host`, tabs
// inside the URL, and `<template>` content. The check is fail-closed: any
// absolute URL, or one with an authority, is third-party.
import { JSDOM } from 'jsdom';

/** [element, attribute] pairs where the browser fetches (or re-bases) a URL. */
const LOADERS = [
  ['script', 'src'],
  ['link', 'href'],
  ['base', 'href'],
];

/**
 * What a browser does before it looks at the URL: trims control characters and
 * spaces, drops tabs and newlines anywhere, and reads `\\` as `/`.
 */
function normalize(value) {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) <= 0x20) start++;
  while (end > start && value.charCodeAt(end - 1) <= 0x20) end--;
  return value
    .slice(start, end)
    .replace(/[\t\n\r]/g, '')
    .replace(/\\/g, '/');
}

// The raw URL decides, not where it would resolve: only a relative reference
// (no scheme, no `//` authority) stays on the site by construction. Resolving
// against a made-up base is unsafe: `http:x.test/a.js` is a relative path under
// an http base, and a made-up host can be named by the URL itself.
function isThirdParty(value, siteOrigin) {
  const url = normalize(value);
  if (/^data:/i.test(url)) return false; // no host to contact
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//');
  if (!absolute) return false;
  if (!siteOrigin) return true; // an absolute URL is third-party unless we know our origin
  try {
    return new URL(url, siteOrigin).origin !== new URL(siteOrigin).origin;
  } catch {
    return true;
  }
}

/**
 * The raw attribute values of every third-party script, stylesheet/link and
 * <base>. `siteOrigin` (e.g. `https://user.github.io`) is the one origin an
 * absolute URL may have; without it every absolute URL is third-party.
 */
export function findExternalAssets(html, { siteOrigin } = {}) {
  const { window } = new JSDOM(html);
  const found = [];
  const scan = (root) => {
    for (const [tag, attribute] of LOADERS) {
      for (const element of root.querySelectorAll(`${tag}[${attribute}]`)) {
        const value = element.getAttribute(attribute);
        if (isThirdParty(value, siteOrigin)) found.push(value);
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
