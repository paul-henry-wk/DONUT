// =====================================================================
// app/modals.ts -- Modal system (showModal, showConfirm, showPrompt)
// =====================================================================

import type { ModalOptions } from '../types';

// ── Modal system ──
export function showModal(opts: ModalOptions): Promise<string | boolean | null> {
  const { title, message, inputPlaceholder, inputValue, confirmLabel, cancelLabel, danger } = opts;
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const box = document.createElement('div');
    box.className = 'modal-box';

    // Title
    const titleEl = document.createElement('div');
    titleEl.className = 'modal-title' + (danger ? ' danger' : '');
    titleEl.textContent = title || '';
    box.appendChild(titleEl);

    // Message (supports HTML when html property is set)
    if (message) {
      const msgEl = document.createElement('div');
      msgEl.className = 'modal-msg';
      if ((opts as any).html) { msgEl.innerHTML = message; }
      else { msgEl.textContent = message; }
      box.appendChild(msgEl);
    }

    // Input (for prompt-style modals)
    let input: HTMLInputElement | null = null;
    if (inputPlaceholder !== undefined) {
      input = document.createElement('input');
      input.className = 'modal-input';
      input.type = 'text';
      input.placeholder = inputPlaceholder || '';
      input.value = inputValue || '';
      input.autocomplete = 'off';
      box.appendChild(input);
    }

    // Buttons
    const btns = document.createElement('div');
    btns.className = 'modal-btns';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'modal-btn cancel';
    cancelBtn.textContent = cancelLabel || 'Cancel';
    const okBtn = document.createElement('button');
    okBtn.className = 'modal-btn' + (danger ? ' danger' : ' primary');
    okBtn.textContent = confirmLabel || (danger ? 'Confirm' : 'OK');
    btns.appendChild(cancelBtn);
    btns.appendChild(okBtn);
    box.appendChild(btns);

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // Focus input or confirm button
    setTimeout(() => { if (input) input.focus(); else okBtn.focus(); }, 50);

    // Enter key submits
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') { e.preventDefault(); doConfirm(); }
      if (e.key === 'Escape') { e.preventDefault(); doCancel(); }
    };
    overlay.addEventListener('keydown', onKey);

    function doConfirm(): void {
      overlay.remove();
      resolve(input ? input.value : true);
    }
    function doCancel(): void {
      overlay.remove();
      resolve(input ? null : false);
    }

    okBtn.onclick = doConfirm;
    cancelBtn.onclick = doCancel;
    overlay.addEventListener('click', (e: MouseEvent) => { if (e.target === overlay) doCancel(); });
  });
}

// ── Convenience wrappers ──
export function showConfirm(title: string, msg: string): Promise<string | boolean | null> {
  return showModal({ title, message: msg, danger: true });
}

export function showPrompt(title: string, placeholder: string, defaultValue?: string): Promise<string | boolean | null> {
  return showModal({ title, inputPlaceholder: placeholder, inputValue: defaultValue });
}
