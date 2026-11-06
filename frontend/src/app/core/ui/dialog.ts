/** Native <dialog> open/close with the design-system exit animation and focus return (fb.js openDialog/closeDialog). */
const openers = new WeakMap<HTMLDialogElement, Element | null>();

export function openDialog(d: HTMLDialogElement, opener?: Element | null): void {
  openers.set(d, opener ?? document.activeElement);
  d.classList.remove('is-closing');
  if (!d.open) d.showModal();
  const focusEl = d.querySelector<HTMLElement>('[autofocus]') ?? d.querySelector<HTMLElement>('.fb-dialog__body input, .fb-dialog__body textarea, .fb-dialog__body select');
  focusEl?.focus();
}

export function closeDialog(d: HTMLDialogElement, returnFocusTo?: HTMLElement | null): Promise<void> {
  return new Promise((resolve) => {
    if (!d.open || d.classList.contains('is-closing')) return resolve();
    const done = () => {
      d.classList.remove('is-closing');
      d.close();
      const o = (returnFocusTo ?? openers.get(d)) as HTMLElement | null | undefined;
      if (o && document.contains(o)) o.focus?.();
      resolve();
    };
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return done();
    d.classList.add('is-closing');
    setTimeout(done, 140);
  });
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}
