import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(import.meta.dirname, '../../../..');
const appsDir = join(workspaceRoot, 'apps');

/** `defineAppConfig` derives the preview port as the dev port plus this. */
const PREVIEW_PORT_OFFSET = 100;

interface AppPort {
  appName: string;
  devPort: number;
}

interface ShellAttributes {
  lang?: string;
  dir?: string;
}

/**
 * Every port an app occupies: its dev port and its preview port. Two apps may
 * not share any port, including one app's dev port with another's preview port.
 */
function findPortCollisions(apps: AppPort[]): string[] {
  const ownersByPort = new Map<number, string[]>();
  const claimPort = (port: number, owner: string) =>
    ownersByPort.set(port, [...(ownersByPort.get(port) ?? []), owner]);

  for (const { appName, devPort } of apps) {
    claimPort(devPort, `${appName} (dev)`);
    claimPort(devPort + PREVIEW_PORT_OFFSET, `${appName} (preview)`);
  }
  return [...ownersByPort]
    .filter(([, owners]) => owners.length > 1)
    .map(([port, owners]) => `port ${port} is used by ${owners.join(' and ')}`);
}

/** The first node that `isMatch` accepts, searching `root` depth first. */
function findNode<TNode extends ts.Node>(
  root: ts.Node,
  isMatch: (node: ts.Node) => node is TNode,
): TNode | undefined {
  if (isMatch(root)) return root;
  return ts.forEachChild(root, (child) => findNode(child, isMatch));
}

function parseTypeScript(source: string): ts.SourceFile {
  return ts.createSourceFile('config.ts', source, ts.ScriptTarget.Latest, true);
}

/** The property named `name` (as an identifier or a string) in an object literal. */
function findProperty(
  objectLiteral: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const propertyName = property.name;
    const isNamed =
      (ts.isIdentifier(propertyName) || ts.isStringLiteralLike(propertyName)) &&
      propertyName.text === name;
    if (isNamed) return property.initializer;
  }
  return undefined;
}

function isCallTo(
  functionName: string,
): (node: ts.Node) => node is ts.CallExpression {
  return (node): node is ts.CallExpression =>
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === functionName;
}

/** The numeric `port` that a vite.config passes to `defineAppConfig`, if any. */
function readDevPort(viteConfigSource: string): number | undefined {
  const call = findNode(
    parseTypeScript(viteConfigSource),
    isCallTo('defineAppConfig'),
  );
  const options = call?.arguments[1];
  if (!options || !ts.isObjectLiteralExpression(options)) return undefined;
  const port = findProperty(options, 'port');
  return port && ts.isNumericLiteral(port) ? Number(port.text) : undefined;
}

/** `lang` and `dir` of the object passed to VitePress `defineConfig`. */
function readVitepressShell(configSource: string): ShellAttributes {
  const call = findNode(
    parseTypeScript(configSource),
    isCallTo('defineConfig'),
  );
  const options = call?.arguments[0];
  if (!options || !ts.isObjectLiteralExpression(options)) {
    throw new Error('no defineConfig({ ... }) call found');
  }
  const stringValue = (name: string) => {
    const value = findProperty(options, name);
    return value && ts.isStringLiteralLike(value) ? value.text : undefined;
  };
  return { lang: stringValue('lang'), dir: stringValue('dir') };
}

const HTML_WHITESPACE = /\s/;

/**
 * Reads the attributes of a start tag whose name ended at `position`. Quoted
 * values may contain `>`; an attribute repeated in a tag keeps its first value,
 * as in an HTML parser. Returns the attributes and the position after the tag.
 */
function readTagAttributes(
  html: string,
  position: number,
): { attributes: Map<string, string>; end: number } {
  const attributes = new Map<string, string>();
  while (position < html.length && html[position] !== '>') {
    if (HTML_WHITESPACE.test(html[position]) || html[position] === '/') {
      position++;
      continue;
    }
    const name =
      /^[^\s"'>/=]+/.exec(html.slice(position))?.[0] ?? html[position];
    position += name.length;
    while (HTML_WHITESPACE.test(html[position] ?? '')) position++;
    let value = '';
    if (html[position] === '=') {
      position++;
      while (HTML_WHITESPACE.test(html[position] ?? '')) position++;
      const quote = html[position];
      if (quote === '"' || quote === "'") {
        const closingQuote = html.indexOf(quote, position + 1);
        const end = closingQuote === -1 ? html.length : closingQuote;
        value = html.slice(position + 1, end);
        position = end + 1;
      } else {
        value = /^[^\s>]*/.exec(html.slice(position))?.[0] ?? '';
        position += value.length;
      }
    }
    const key = name.toLowerCase();
    if (!attributes.has(key)) attributes.set(key, value);
  }
  return { attributes, end: position + 1 };
}

/**
 * The attributes of the first `<html>` start tag in a document. Comments and
 * declarations are skipped, so a tag written inside a comment does not count.
 */
function readHtmlShell(html: string): ShellAttributes {
  let position = 0;
  while (position < html.length) {
    const tagStart = html.indexOf('<', position);
    if (tagStart === -1) break;
    if (html.startsWith('<!--', tagStart)) {
      const afterOpening = tagStart + '<!--'.length;
      // `<!-->` and `<!--->` are empty comments; otherwise a comment ends at `-->`.
      if (html.startsWith('>', afterOpening)) {
        position = afterOpening + 1;
        continue;
      }
      if (html.startsWith('->', afterOpening)) {
        position = afterOpening + 2;
        continue;
      }
      const commentEnd = html.indexOf('-->', afterOpening);
      if (commentEnd === -1) break; // unterminated: the rest is a comment
      position = commentEnd + '-->'.length;
      continue;
    }
    const tagName = /^<([A-Za-z][^\s/>]*)/.exec(html.slice(tagStart));
    if (!tagName) {
      // `<!doctype>`, an end tag, or stray `<`: skip to the next `>`.
      const declarationEnd = html.indexOf('>', tagStart);
      position = declarationEnd === -1 ? html.length : declarationEnd + 1;
      continue;
    }
    const { attributes, end } = readTagAttributes(
      html,
      tagStart + tagName[0].length,
    );
    if (tagName[1].toLowerCase() === 'html') {
      return { lang: attributes.get('lang'), dir: attributes.get('dir') };
    }
    position = end;
  }
  return {};
}

/** True if the shell is Hebrew and right-to-left, whatever the spelling around it. */
function isHebrewRtlShell({ lang, dir }: ShellAttributes): boolean {
  return lang?.toLowerCase() === 'he' && dir?.toLowerCase() === 'rtl';
}

const appDirNames = readdirSync(appsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const appNamesWithViteConfig = appDirNames.filter((name) =>
  existsSync(join(appsDir, name, 'vite.config.mts')),
);

function readConfiguredDevPort(appName: string): number {
  const devPort = readDevPort(
    readFileSync(join(appsDir, appName, 'vite.config.mts'), 'utf8'),
  );
  if (devPort === undefined) {
    throw new Error(
      `apps/${appName}/vite.config.mts does not call defineAppConfig with a numeric port`,
    );
  }
  return devPort;
}

describe('app dev and preview ports', () => {
  it('finds at least one app using defineAppConfig', () => {
    expect(appNamesWithViteConfig.length).toBeGreaterThan(0);
  });

  it('gives every app its own ports, dev and preview together', () => {
    const apps = appNamesWithViteConfig.map((appName) => ({
      appName,
      devPort: readConfiguredDevPort(appName),
    }));

    expect(findPortCollisions(apps)).toEqual([]);
  });

  it('fails when a dev port equals another app preview port', () => {
    const collisions = findPortCollisions([
      { appName: 'first', devPort: 4200 },
      { appName: 'second', devPort: 4200 + PREVIEW_PORT_OFFSET },
    ]);

    expect(collisions).toEqual([
      'port 4300 is used by first (preview) and second (dev)',
    ]);
  });

  it('fails on two equal dev ports, and passes distinct ones', () => {
    expect(
      findPortCollisions([
        { appName: 'first', devPort: 4200 },
        { appName: 'second', devPort: 4200 },
      ]),
    ).not.toEqual([]);
    expect(
      findPortCollisions([
        { appName: 'first', devPort: 4200 },
        { appName: 'second', devPort: 4201 },
      ]),
    ).toEqual([]);
  });

  it('reads the port from the defineAppConfig call, not from a comment', () => {
    expect(
      readDevPort(`
        // defineAppConfig(import.meta.dirname, { port: 1111 })
        export default defineConfig(
          defineAppConfig(import.meta.dirname, { port: 4200 }),
        );
      `),
    ).toBe(4200);
    expect(readDevPort('export default defineConfig({});')).toBeUndefined();
  });
});

describe('RTL Hebrew shell', () => {
  const appNamesWithIndexHtml = appDirNames.filter((name) =>
    existsSync(join(appsDir, name, 'index.html')),
  );

  it('finds at least one app with an index.html', () => {
    expect(appNamesWithIndexHtml.length).toBeGreaterThan(0);
  });

  it.each(appNamesWithIndexHtml)(
    'apps/%s/index.html declares lang="he" dir="rtl" on <html>',
    (name) => {
      const html = readFileSync(join(appsDir, name, 'index.html'), 'utf8');
      expect(isHebrewRtlShell(readHtmlShell(html))).toBe(true);
    },
  );

  it.each([
    [
      'attributes in another order, with extra ones',
      '<html dir="rtl" lang="he" class="x">',
    ],
    ['single quotes and unquoted values', "<html lang='he' dir=rtl>"],
    ['upper case names and values', '<HTML LANG="HE" DIR="RTL">'],
    [
      'a ">" inside another attribute value',
      '<html data-x="a>b" lang="he" dir="rtl">',
    ],
    [
      'a doctype and a comment before the tag',
      '<!doctype html><!-- note --><html lang="he" dir="rtl">',
    ],
    ['an empty comment before the tag', '<!--><html lang="he" dir="rtl">'],
  ])('accepts %s', (_name, html) => {
    expect(isHebrewRtlShell(readHtmlShell(html))).toBe(true);
  });

  it.each([
    [
      'an RTL tag inside a comment followed by a real English tag',
      '<!-- <html lang="he" dir="rtl"> --><html lang="en">',
    ],
    ['a missing dir', '<html lang="he">'],
    ['a left-to-right dir', '<html lang="he" dir="ltr">'],
    ['an English lang', '<html lang="en" dir="rtl">'],
    [
      'a document with no html tag',
      '<!doctype html><body>lang="he" dir="rtl"</body>',
    ],
    [
      'the attributes on another element',
      '<html lang="en"><body lang="he" dir="rtl">',
    ],
    [
      'an unterminated comment that hides the tag',
      '<!-- <html lang="he" dir="rtl">',
    ],
  ])('rejects %s', (_name, html) => {
    expect(isHebrewRtlShell(readHtmlShell(html))).toBe(false);
  });

  it("apps/docs/.vitepress/config.ts declares lang: 'he' and dir: 'rtl'", () => {
    const source = readFileSync(
      join(appsDir, 'docs/.vitepress/config.ts'),
      'utf8',
    );
    expect(isHebrewRtlShell(readVitepressShell(source))).toBe(true);
  });

  describe('the VitePress config reader', () => {
    const shellOf = (properties: string) =>
      readVitepressShell(`export default defineConfig({ ${properties} });`);

    it("fails dir: 'ltr' even when a comment or a string contains dir: 'rtl'", () => {
      expect(
        isHebrewRtlShell(
          shellOf(`
            lang: 'he',
            // dir: 'rtl'
            /* dir: 'rtl' */
            description: "dir: 'rtl'",
            dir: 'ltr',
          `),
        ),
      ).toBe(false);
    });

    it('accepts any property order, extra properties and quoted keys', () => {
      expect(
        isHebrewRtlShell(shellOf(`title: 'x', 'dir': 'rtl', lang: 'he'`)),
      ).toBe(true);
    });

    it('fails when lang or dir is missing or not a plain string', () => {
      expect(isHebrewRtlShell(shellOf(`lang: 'he'`))).toBe(false);
      expect(isHebrewRtlShell(shellOf(`lang: 'he', dir: direction`))).toBe(
        false,
      );
    });

    it('throws when there is no defineConfig call', () => {
      expect(() => readVitepressShell('export default {};')).toThrow(
        /no defineConfig/,
      );
    });
  });
});
