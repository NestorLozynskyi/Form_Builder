import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = (_r, state) => {
  const auth = inject(AuthService);
  return auth.user() ? true : inject(Router).createUrlTree(['/sign-in'], { queryParams: { returnUrl: state.url } });
};

export const guestGuard: CanActivateFn = () => (inject(AuthService).user() ? inject(Router).createUrlTree(['/forms']) : true);
