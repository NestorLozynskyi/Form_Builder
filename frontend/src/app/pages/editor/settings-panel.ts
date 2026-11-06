import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { publicUrl } from '../../core/api/api.service';
import { ACCENTS, accentInfo, formatRatio, contrast, normalizeHex } from '../../core/ui/accent';
import { copyText } from '../../core/ui/dialog';
import { Icon } from '../../core/ui/icon';
import { ToastService } from '../../core/ui/toast.service';
import { AccentDirective } from '../public/accent.directive';
import { EditorStore } from './editor.store';

/** Form settings tab (editor.html renderSettings): title, description, success message, accent, sharing, responses. */
@Component({
  selector: 'app-settings-panel',
  imports: [Icon, RouterLink, AccentDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings-panel.html',
})
export class SettingsPanel {
  protected readonly s = inject(EditorStore);
  private readonly toast = inject(ToastService);
  readonly closeResponses = output<HTMLElement>();
  readonly reopen = output<void>();
  protected readonly accents = ACCENTS;
  protected readonly hexInvalid = signal(false);
  protected readonly hexText = signal<string | null>(null);

  protected readonly accent = computed(() => this.s.draft()?.accent ?? 'cobalt');
  protected readonly preset = computed(() => ACCENTS.find((a) => a.key === this.accent()) ?? null);
  protected readonly hex = computed(() => this.preset()?.light ?? normalizeHex(this.accent()) ?? '#2347C5');
  protected readonly info = computed(() => accentInfo(this.accent()));
  protected readonly ratioDark = computed(() => {
    const i = this.info();
    return i ? formatRatio(contrast(i.dark, '#161920')) : '';
  });
  protected readonly ratio = computed(() => formatRatio(this.info()?.ratio ?? 0));
  protected readonly link = computed(() => {
    const id = this.s.form()?.publicId;
    return id ? publicUrl(id) : '';
  });

  protected field(key: 'title' | 'description' | 'successMessage', ev: Event): void {
    this.s.updateForm({ [key]: (ev.target as HTMLInputElement).value });
  }

  private setAccent(a: string, fromHex = false): void {
    const hex = normalizeHex(a);
    if (hex) a = ACCENTS.find((x) => x.light === hex)?.key ?? hex;
    this.hexInvalid.set(false);
    if (!fromHex) this.hexText.set(null);
    this.s.updateForm({ accent: a });
  }

  protected pickSwatch(key: string): void {
    if (key === 'custom') {
      const typed = normalizeHex(this.hexText() ?? '');
      this.setAccent(typed && !this.preset() ? typed : this.preset() ? '#7A3EF0' : this.hex());
    } else this.setAccent(key);
  }

  protected onHex(ev: Event): void {
    const v = (ev.target as HTMLInputElement).value;
    this.hexText.set(v);
    const n = normalizeHex(v);
    const digits = v.replace('#', '').length;
    if (n && digits === 6) this.setAccent(n, true);
    else this.hexInvalid.set(digits >= 6);
  }

  protected onColor(ev: Event): void {
    const n = normalizeHex((ev.target as HTMLInputElement).value);
    if (n) this.setAccent(n);
  }

  protected async copy(): Promise<void> {
    await copyText(this.link());
    this.toast.show({ type: 'success', title: 'Public link copied', timeout: 3000 });
  }
}
