import { afterEach, describe, expect, it, vi } from 'vitest';

import { installDialogFallbacks, onBackdrop, runCommand } from '../dialogs.ts';

const showModal = vi.fn();

function byId(id: string): Element {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return element;
}

function byTag<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
  const element = document.querySelector(tag);
  if (!element) throw new Error(`missing ${tag}`);
  return element;
}

function page(html: string) {
  document.body.innerHTML = html;
  const dialog = byTag('dialog');
  const state = { open: false };
  Object.defineProperty(dialog, 'open', { get: () => state.open, configurable: true });
  dialog.showModal = showModal.mockImplementation(() => {
    state.open = true;
  });
  dialog.close = vi.fn(() => {
    state.open = false;
  });
  return dialog;
}

function click(target: Element, x = 0, y = 0) {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  showModal.mockReset();
  delete (HTMLButtonElement.prototype as Partial<{ commandForElement: unknown }>).commandForElement;
  delete (HTMLDialogElement.prototype as Partial<{ closedBy: unknown }>).closedBy;
});

describe('runCommand', () => {
  it('opens and closes the dialog a button points at, once', () => {
    page(`
      <button id="open" commandfor="d" command="show-modal">פתח</button>
      <dialog id="d"><button id="close" commandfor="d" command="close">סגור</button></dialog>`);
    const open = byId('open');
    const close = byId('close');
    expect(runCommand(open, document)).toBe(true);
    expect(runCommand(open, document)).toBe(false);
    expect(runCommand(close, document)).toBe(true);
    expect(runCommand(close, document)).toBe(false);
    expect(showModal).toHaveBeenCalledOnce();
  });

  it('ignores buttons without a dialog target or with an unknown command', () => {
    page('<dialog id="d"></dialog><div id="x"></div>');
    const button = document.createElement('button');
    expect(runCommand(button, document)).toBe(false);
    button.setAttribute('commandfor', 'x');
    expect(runCommand(button, document)).toBe(false);
    button.setAttribute('commandfor', 'd');
    button.setAttribute('command', 'toggle');
    expect(runCommand(button, document)).toBe(false);
  });
});

describe('installDialogFallbacks', () => {
  const html = `
    <button id="open" commandfor="d" command="show-modal"><span id="label">פתח</span></button>
    <dialog id="d" closedby="any"><p id="inside">תוכן</p></dialog>`;

  it('runs command buttons and closes on a backdrop click in older browsers', () => {
    const dialog = page(html);
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 100, 100));
    installDialogFallbacks(window);
    click(byId('label'));
    expect(dialog.open).toBe(true);
    click(byId('inside'));
    click(dialog, 50, 50);
    expect(dialog.open).toBe(true);
    click(dialog, 500, 500);
    expect(dialog.open).toBe(false);
    click(document.body);
  });

  it('adds nothing where the browser supports both attributes', () => {
    const dialog = page(html);
    Object.defineProperty(HTMLButtonElement.prototype, 'commandForElement', {
      value: null,
      configurable: true,
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'closedBy', {
      value: 'any',
      configurable: true,
    });
    const onDocument = vi.spyOn(document, 'addEventListener');
    const onDialog = vi.spyOn(dialog, 'addEventListener');
    installDialogFallbacks(window);
    expect(onDocument).not.toHaveBeenCalled();
    expect(onDialog).not.toHaveBeenCalled();
  });
});

describe('onBackdrop', () => {
  it('only counts clicks on the dialog element itself, outside its box', () => {
    const dialog = page('<dialog><p>x</p></dialog>');
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 10, 10));
    const outside = new MouseEvent('click', { clientX: 20, clientY: 5 });
    Object.defineProperty(outside, 'target', { value: dialog });
    expect(onBackdrop(dialog, outside)).toBe(true);
    const child = new MouseEvent('click', { clientX: 20, clientY: 5 });
    Object.defineProperty(child, 'target', { value: dialog.firstElementChild });
    expect(onBackdrop(dialog, child)).toBe(false);
  });
});
