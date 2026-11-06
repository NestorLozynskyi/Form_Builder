import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { Icon } from '../../core/ui/icon';
import { MenuTrigger } from '../../core/ui/menu';
import { EditorStore, titleOf } from './editor.store';

/** Status badge · unpublished marker · autosave indicator · issues menu (editor.html metaHTML). */
@Component({
  selector: 'app-editor-meta',
  imports: [Icon, MenuTrigger],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    @switch (s.status()) {
      @case ('draft') {
        <span class="fb-badge fb-badge--sm fb-badge--draft"><svg appIcon="dashed-circle"></svg>Draft</span>
      }
      @case ('closed') {
        <span class="fb-badge fb-badge--sm fb-badge--closed"><svg appIcon="lock"></svg>Closed · v{{ s.liveVersion() }}</span>
      }
      @default {
        <span class="fb-badge fb-badge--sm fb-badge--published"><svg appIcon="dot"></svg>Published · v{{ s.liveVersion() }}</span>
      }
    }
    @if (s.unpublished()) {
      <span class="fb-badge fb-badge--sm fb-badge--unpublished" [title]="'Unpublished changes — respondents still get v' + s.liveVersion() + '. Publish to update it.'"><svg appIcon="ring"></svg><span class="ed-unpub-text">Unpublished changes</span></span>
    }
    <span class="fb-save fb-save--{{ s.save() }}" role="status">
      @switch (s.save()) {
        @case ('saving') { <svg class="icon--spin" appIcon="loader"></svg><span class="fb-save__text">Saving…</span> }
        @case ('failed') {
          <svg appIcon="cloud-off"></svg><span class="fb-save__text">Save failed</span>
          <button type="button" class="fb-btn fb-btn--link fb-btn--sm fb-save__retry" (click)="s.retryNow()">Retry</button>
        }
        @default { <svg appIcon="cloud-check"></svg><span class="fb-save__text">Saved</span> }
      }
    </span>
    @if (s.allIssues().length; as n) {
      <div class="fb-menu-anchor">
        <button type="button" class="fb-btn fb-btn--sm ed-issues" appMenuTrigger>
          <svg appIcon="alert-circle"></svg><span>{{ n }} {{ n === 1 ? 'issue' : 'issues' }}<span class="ed-issues-long"> to fix before publishing</span></span><svg class="icon--sm" appIcon="chevron-down"></svg>
        </button>
        <div class="fb-menu fb-menu--start ed-issues-menu" role="menu" aria-label="Issues to fix" hidden>
          @for (x of s.allIssues(); track x.block.id + x.issue.key) {
            <button type="button" class="fb-menu__item ed-issue" role="menuitem" (click)="jump.emit(x.block.id)">
              <svg appIcon="alert-circle"></svg>
              <span class="ed-issue__txt"><span class="ed-issue__field">{{ title(x.block) }}</span><span class="ed-issue__msg">{{ x.issue.message }}</span></span>
            </button>
          }
        </div>
      </div>
    }
  `,
})
export class EditorMeta {
  protected readonly s = inject(EditorStore);
  readonly jump = output<string>();
  protected readonly title = titleOf;
}
