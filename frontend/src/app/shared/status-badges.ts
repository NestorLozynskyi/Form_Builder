import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormStatus } from '../core/api/models';
import { Icon } from '../core/ui/icon';

/** Status badge + live version chip + "Unpublished changes" badge (design-system STATUS block). */
@Component({
  selector: 'app-status-badges',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @switch (status()) {
      @case ('draft') {
        <span class="fb-badge fb-badge--draft" [class.fb-badge--sm]="small()"><svg appIcon="dashed-circle"></svg>Draft</span>
      }
      @case ('published') {
        <span class="fb-badge fb-badge--published" [class.fb-badge--sm]="small()"><svg appIcon="dot"></svg>Published</span>
      }
      @case ('closed') {
        <span class="fb-badge fb-badge--closed" [class.fb-badge--sm]="small()"><svg appIcon="lock"></svg>Closed</span>
      }
    }
    @if (version() && showVersion()) {
      <span class="fb-version" title="Live version">v{{ version() }}</span>
    }
    @if (unpublished()) {
      <span class="fb-badge fb-badge--unpublished" [class.fb-badge--sm]="small()"><svg appIcon="ring"></svg>Unpublished changes</span>
    }
  `,
})
export class StatusBadges {
  readonly status = input.required<FormStatus>();
  readonly version = input<number | null>(null);
  readonly unpublished = input(false);
  readonly small = input(true);
  readonly showVersion = input(true);
}
