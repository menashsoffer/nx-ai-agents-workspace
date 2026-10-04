// Finds third-party assets in an HTML document (docs/security.md, P1).
// Shared by assemble.mjs (the whole Pages artifact) and
// .github/scripts/code-map.mjs (graphify's page).
//
// The HTML is parsed (jsdom, no scripts executed) and each URL is resolved
// as a browser would read it. A regex over the source misses legal HTML: spaces
// around `=`, unquoted values, entities (`&#x2F;&#x2F;host`), `\\host`, tabs
// inside the URL, and `<template>` content. The check is fail-closed: any
// absolute URL, or one with an authority, is third-party. Detected: `<script
// src>`, `<link href>`, `<base href>`, a `<style>` element's `@import` and
// `url(...)`, a `style=""` attribute's `url(...)`, and `srcset` candidates.
import { JSDOM } from 'jsdom';

/** [element, attribute] pairs where the browser fetches (or re-bases) a URL. */
const URL_LOADING_ELEMENT_ATTRIBUTES = [
  ['script', 'src'],
  ['link', 'href'],
  ['base', 'href'],
];

/** Every `url(...)` and bare `@import "..."` reference in a CSS text. */
function extractCssUrls(text) {
  const urls = [];
  const urlPattern = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;
  for (const match of text.matchAll(urlPattern)) urls.push(match[2]);
  const importPattern = /@import\s+(['"])([^'"]*)\1/gi;
  for (const match of text.matchAll(importPattern)) urls.push(match[2]);
  return urls;
}

/** The URL of each comma-separated `srcset` candidate, descriptor stripped. */
function extractSrcsetUrls(value) {
  return value
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter(Boolean);
}

/**
 * What a browser does before it looks at the URL: trims control characters and
 * spaces, drops tabs and newlines anywhere, and reads `\\` as `/`.
 */
function normalizeUrl(value) {
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
  const url = normalizeUrl(value);
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
 * The raw URL of every third-party script, stylesheet/link, <base>, <style>
 * `@import`/`url()`, `style=""` `url()` and `srcset` candidate. `siteOrigin`
 * (e.g. `https://user.github.io`) is the one origin an absolute URL may have;
 * without it every absolute URL is third-party.
 */
export function findExternalAssets(html, { siteOrigin } = {}) {
  const { window } = new JSDOM(html);
  const externalAssetUrls = [];
  const scan = (root) => {
    for (const [tag, attribute] of URL_LOADING_ELEMENT_ATTRIBUTES) {
      for (const element of root.querySelectorAll(`${tag}[${attribute}]`)) {
        const value = element.getAttribute(attribute);
        if (isThirdParty(value, siteOrigin)) externalAssetUrls.push(value);
      }
    }
    for (const style of root.querySelectorAll('style')) {
      for (const url of extractCssUrls(style.textContent ?? '')) {
        if (isThirdParty(url, siteOrigin)) found.push(url);
      }
    }
    for (const element of root.querySelectorAll('[style]')) {
      for (const url of extractCssUrls(element.getAttribute('style'))) {
        if (isThirdParty(url, siteOrigin)) found.push(url);
      }
    }
    for (const element of root.querySelectorAll('[srcset]')) {
      for (const url of extractSrcsetUrls(element.getAttribute('srcset'))) {
        if (isThirdParty(url, siteOrigin)) found.push(url);
      }
    }
    // querySelectorAll does not look inside <template> content.
    for (const template of root.querySelectorAll('template')) {
      scan(template.content);
    }
  };
  scan(window.document);
  window.close();
  return externalAssetUrls;
}
