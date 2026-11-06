import { Directive, ElementRef, HostListener, inject } from '@angular/core';

/**
 * Put on the trigger button of a `.fb-menu-anchor`; toggles the next `.fb-menu` / `.fb-popover` sibling.
 * Closes on outside click, Escape and after choosing an item; arrow keys move between items (fb.js menu behaviour).
 */
@Directive({
  selector: '[appMenuTrigger]',
  host: { 'aria-haspopup': 'menu', '[attr.aria-expanded]': 'open' },
})
export class MenuTrigger {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  protected open = false;
  private keyboard = false;
  private static current: MenuTrigger | null = null;

  private get menu(): HTMLElement | null {
    let n = this.el.nativeElement.nextElementSibling as HTMLElement | null;
    while (n && !(n.classList.contains('fb-menu') || n.classList.contains('fb-popover'))) n = n.nextElementSibling as HTMLElement | null;
    return n;
  }

  private items(): HTMLElement[] {
    return Array.from(this.menu?.querySelectorAll<HTMLElement>('.fb-menu__item:not(:disabled):not([aria-disabled="true"])') ?? []);
  }

  toggle(force?: boolean): void {
    const open = force ?? !this.open;
    if (open && MenuTrigger.current && MenuTrigger.current !== this) MenuTrigger.current.toggle(false);
    this.open = open;
    MenuTrigger.current = open ? this : MenuTrigger.current === this ? null : MenuTrigger.current;
    const m = this.menu;
    if (m) m.hidden = !open;
    this.el.nativeElement.setAttribute('aria-expanded', String(open));
    if (open && this.keyboard) this.items()[0]?.focus();
  }

  @HostListener('click')
  onClick(): void {
    this.toggle();
    this.keyboard = false;
  }

  @HostListener('keydown', ['$event'])
  onTriggerKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') this.keyboard = true;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.toggle(true);
    }
  }

  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent): void {
    if (!this.open) return;
    const t = e.target as Node;
    if (this.el.nativeElement.contains(t)) return;
    const m = this.menu;
    if (m?.contains(t) && !(t as Element).closest?.('.fb-menu__item')) return;
    this.toggle(false);
  }

  @HostListener('document:keydown', ['$event'])
  onDocKey(e: KeyboardEvent): void {
    if (!this.open) return;
    const items = this.items();
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      this.toggle(false);
      this.el.nativeElement.focus();
    } else if (e.key === 'ArrowDown' && i > -1) {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp' && i > -1) {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Tab') {
      this.toggle(false);
    }
  }
}
