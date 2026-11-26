/* Dialog buttons are declared in HTML with commandfor/command, and the read-only supplier
   dialog closes on a backdrop click with closedby="any". This file only fills the gaps in
   browsers that do not support those attributes yet; elsewhere it adds nothing. */

/** Opens or closes the dialog a command button points at. Returns false for other buttons. */
export function runCommand(button: Element, doc: Document): boolean {
  const id = button.getAttribute('commandfor');
  const command = button.getAttribute('command');
  const target = id ? doc.getElementById(id) : null;
  if (target?.tagName !== 'DIALOG') return false;
  const dialog = target as HTMLDialogElement;
  if (command === 'show-modal' && !dialog.open) dialog.showModal();
  else if (command === 'close' && dialog.open) dialog.close();
  else return false;
  return true;
}

/** True when a click on a dialog element landed on its backdrop rather than its content. */
export function onBackdrop(dialog: HTMLDialogElement, event: MouseEvent): boolean {
  if (event.target !== dialog) return false;
  const box = dialog.getBoundingClientRect();
  const inside =
    box.top <= event.clientY &&
    event.clientY <= box.bottom &&
    box.left <= event.clientX &&
    event.clientX <= box.right;
  return !inside;
}

function supportsCommands(doc: Document): boolean {
  return 'commandForElement' in doc.createElement('button');
}

function supportsClosedBy(doc: Document): boolean {
  return 'closedBy' in doc.createElement('dialog');
}

/** Adds the fallbacks the current browser needs. */
export function installDialogFallbacks(win: Window): void {
  const doc = win.document;
  if (!supportsCommands(doc)) {
    doc.addEventListener('click', (event) => {
      const button = (event.target as Element | null)?.closest('button[commandfor]');
      if (button) runCommand(button, doc);
    });
  }
  if (supportsClosedBy(doc)) return;
  for (const dialog of doc.querySelectorAll<HTMLDialogElement>('dialog[closedby="any"]')) {
    dialog.addEventListener('click', (event) => {
      if (onBackdrop(dialog, event)) dialog.close();
    });
  }
}
