import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastRegion } from './core/ui/toast-region';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastRegion],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<router-outlet /><app-toast-region />`,
})
export class App {}
