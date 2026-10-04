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
// CSS is read with a tokenizer (css-tokens.mjs) and `srcset` with the HTML
// spec's algorithm, not with regular expressions.
import { JSDOM } from 'jsdom';
import { tokenizeCss } from './css-tokens.mjs';

/** [element, attribute] pairs where the browser fetches (or re-bases) a URL. */
const URL_LOADING_ELEMENT_ATTRIBUTES = [
  ['script', 'src'],
  ['link', 'href'],
  ['base', 'href'],
];

/**
 * Every URL a CSS text makes the browser fetch: `url(...)` (quoted or not, also
 * as a `bad-url` that browsers ignore but a fail-closed check keeps) and a bare
 * `@import "..."`. Read with a CSS tokenizer, so comments, escapes and quotes
 * mean what they mean to a browser (see css-tokens.mjs).
 */
function extractCssUrls(cssText) {
  const urls = [];
  const tokens = tokenizeCss(cssText);
  tokens.forEach((token, index) => {
    const nextToken = tokens[index + 1];
    if (token.type === 'url' || token.type === 'bad-url') {
      urls.push(token.value);
    } else if (
      nextToken?.type === 'string' &&
      ((token.type === 'function' && token.value === 'url') ||
        (token.type === 'at-keyword' && token.value === 'import'))
    ) {
      urls.push(nextToken.value);
    }
  });
  return urls;
}

const isAsciiWhitespace = (character) =>
  character === ' ' ||
  character === '\t' ||
  character === '\n' ||
  character === '\f' ||
  character === '\r';

/**
 * The URL of each `srcset` candidate, as the HTML spec parses it
 * (https://html.spec.whatwg.org/#parse-a-srcset-attribute): a URL is a run of
 * non-whitespace characters, so it may contain commas; only commas after the
 * URL's end, outside parentheses, separate candidates. A URL that ends in
 * commas has no descriptors.
 */
function extractSrcsetUrls(srcsetAttribute) {
  const urls = [];
  let position = 0;
  while (position < srcsetAttribute.length) {
    while (
      position < srcsetAttribute.length &&
      (srcsetAttribute[position] === ',' ||
        isAsciiWhitespace(srcsetAttribute[position]))
    ) {
      position++;
    }
    if (position >= srcsetAttribute.length) break;
    const start = position;
    while (
      position < srcsetAttribute.length &&
      !isAsciiWhitespace(srcsetAttribute[position])
    ) {
      position++;
    }
    const rawUrl = srcsetAttribute.slice(start, position);
    const url = rawUrl.replace(/,+$/, '');
    if (url) urls.push(url);
    if (url !== rawUrl) continue; // trailing commas ended the candidate
    // Skip the descriptors, up to a comma that is not inside parentheses.
    let parenthesisDepth = 0;
    while (position < srcsetAttribute.length) {
      const character = srcsetAttribute[position++];
      if (character === '(') parenthesisDepth++;
      else if (character === ')' && parenthesisDepth > 0) parenthesisDepth--;
      else if (character === ',' && parenthesisDepth === 0) break;
    }
  }
  return urls;
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
        if (isThirdParty(url, siteOrigin)) externalAssetUrls.push(url);
      }
    }
    for (const element of root.querySelectorAll('[style]')) {
      for (const url of extractCssUrls(element.getAttribute('style'))) {
        if (isThirdParty(url, siteOrigin)) externalAssetUrls.push(url);
      }
    }
    for (const element of root.querySelectorAll('[srcset]')) {
      for (const url of extractSrcsetUrls(element.getAttribute('srcset'))) {
        if (isThirdParty(url, siteOrigin)) externalAssetUrls.push(url);
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
