import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/api/guards';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'forms' },
  { path: 'sign-in', title: 'Sign in — Form Builder', canActivate: [guestGuard], loadComponent: () => import('./pages/auth/sign-in').then((m) => m.SignInPage) },
  { path: 'sign-up', title: 'Sign up — Form Builder', canActivate: [guestGuard], loadComponent: () => import('./pages/auth/sign-up').then((m) => m.SignUpPage) },
  { path: 'forms', title: 'Forms — Form Builder', canActivate: [authGuard], loadComponent: () => import('./pages/forms/forms-page').then((m) => m.FormsPage) },
  { path: 'forms/:id/edit', title: 'Editor — Form Builder', canActivate: [authGuard], loadComponent: () => import('./pages/editor/editor-page').then((m) => m.EditorPage) },
  { path: 'forms/:id/preview', title: 'Preview — Form Builder', canActivate: [authGuard], loadComponent: () => import('./pages/preview/preview-page').then((m) => m.PreviewPage) },
  { path: 'forms/:id/responses', title: 'Responses — Form Builder', canActivate: [authGuard], loadComponent: () => import('./pages/responses/responses-page').then((m) => m.ResponsesPage) },
  { path: 'forms/:id/responses/:responseId', title: 'Response — Form Builder', canActivate: [authGuard], loadComponent: () => import('./pages/responses/response-detail-page').then((m) => m.ResponseDetailPage) },
  { path: 'f/:publicId', title: 'Form', loadComponent: () => import('./pages/public/public-form-page').then((m) => m.PublicFormPage) },
  { path: 'error', title: 'Something went wrong — Form Builder', loadComponent: () => import('./pages/system/error-page').then((m) => m.ErrorPage) },
  { path: '**', title: 'Page not found — Form Builder', loadComponent: () => import('./pages/system/not-found').then((m) => m.NotFoundPage) },
];
