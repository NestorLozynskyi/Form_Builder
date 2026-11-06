import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** `<svg appIcon="plus" class="icon">` — renders a symbol from the sprite in index.html (fb.js icon set). */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'svg[appIcon]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', focusable: 'false', '[class.icon]': 'true' },
  template: `<svg:use [attr.href]="'#i-' + appIcon()" />`,
})
export class Icon {
  readonly appIcon = input.required<string>();
}
