import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { HttpErrorResponse, HttpInterceptorFn, provideHttpClient, withFetch, withInterceptors, withXsrfConfiguration } from '@angular/common/http';
import { Router, provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { routes } from './app.routes';
import { AuthService } from './core/api/auth.service';
import { ThemeService } from './core/ui/theme.service';

/** A 401 from an authenticated endpoint means the session expired: go to sign-in and come back afterwards. */
const sessionExpiredInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return next(req).pipe(
    catchError((e: unknown) => {
      if (e instanceof HttpErrorResponse && e.status === 401 && !req.url.startsWith('/api/auth/') && !req.url.startsWith('/api/public/') && auth.user()) {
        auth.expired(router.url);
      }
      return throwError(() => e);
    }),
  );
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withFetch(), withXsrfConfiguration({ cookieName: 'XSRF-TOKEN', headerName: 'X-XSRF-TOKEN' }), withInterceptors([sessionExpiredInterceptor])),
    provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    provideAppInitializer(() => {
      inject(ThemeService);
      // Public form pages work without a session; everything else needs to know who is signed in before routing.
      return inject(AuthService).load();
    }),
  ],
};
