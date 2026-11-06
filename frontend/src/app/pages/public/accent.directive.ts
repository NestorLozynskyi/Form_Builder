import { Directive, ElementRef, effect, inject, input } from '@angular/core';
import { ACCENTS, accentStyle } from '../../core/ui/accent';

/** Applies a form accent to a `.fb-public` element: presets via data-accent, custom hex via CSS variables (FB.applyAccent). */
@Directive({ selector: '[appAccent]' })
export class AccentDirective {
  readonly appAccent = input.required<string>();
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    effect(() => {
      const v = this.appAccent();
      const host = this.el.nativeElement;
      const vars = ['--accent-l', '--accent-d', '--on-accent-l', '--on-accent-d', '--accent-soft-l', '--accent-soft-d'];
      if (ACCENTS.some((a) => a.key === v)) {
        host.setAttribute('data-accent', v);
        vars.forEach((k) => host.style.removeProperty(k));
      } else {
        host.removeAttribute('data-accent');
        for (const [k, val] of Object.entries(accentStyle(v))) host.style.setProperty(k, val);
      }
    });
  }
}
