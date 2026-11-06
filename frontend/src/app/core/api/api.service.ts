import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Answers, FormSchema } from '../schema/form-schema';
import { FormDetail, FormStatus, FormSummary, Problem, PublicForm, ResponseDetail, ResponsePage, User } from './models';

/** Error thrown by ApiService: HTTP status (0 = network failure) + problem body. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: Problem,
    readonly retryAfter: number | null = null,
  ) {
    super(problem.title ?? `HTTP ${status}`);
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }

  /** First message per key of a validation problem. */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.problem.errors ?? {})) if (v?.length) out[k] = v[0];
    return out;
  }
}

/** Typed client for docs/api-contract.md. XSRF header is added by Angular's HttpClient XSRF support. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  private async call<T>(req: Promise<T>): Promise<T> {
    try {
      return await req;
    } catch (e) {
      if (e instanceof HttpErrorResponse) {
        const body = (typeof e.error === 'object' && e.error) || {};
        const ra = Number(e.headers?.get('Retry-After'));
        throw new ApiError(e.status, body as Problem, Number.isFinite(ra) && ra > 0 ? ra : null);
      }
      throw e;
    }
  }

  private get<T>(url: string, params?: HttpParams) {
    return this.call(firstValueFrom(this.http.get<T>(url, { params })));
  }
  private post<T>(url: string, body: unknown = {}) {
    return this.call(firstValueFrom(this.http.post<T>(url, body)));
  }
  private put<T>(url: string, body: unknown) {
    return this.call(firstValueFrom(this.http.put<T>(url, body)));
  }
  private del(url: string) {
    return this.call(firstValueFrom(this.http.delete<void>(url)));
  }

  // auth
  session = () => this.get<{ user: User | null }>('/api/auth/session');
  signUp = (email: string, password: string) => this.post<{ user: User }>('/api/auth/sign-up', { email, password });
  signIn = (email: string, password: string) => this.post<{ user: User }>('/api/auth/sign-in', { email, password });
  signOut = () => this.post<void>('/api/auth/sign-out');

  // forms
  listForms = (q?: string, status?: FormStatus) => {
    let p = new HttpParams();
    if (q) p = p.set('q', q);
    if (status) p = p.set('status', status);
    return this.get<FormSummary[]>('/api/forms', p);
  };
  createForm = () => this.post<FormDetail>('/api/forms');
  getForm = (id: string) => this.get<FormDetail>(`/api/forms/${encodeURIComponent(id)}`);
  saveDraft = (id: string, schema: FormSchema) => this.put<FormDetail>(`/api/forms/${encodeURIComponent(id)}/draft`, schema);
  publish = (id: string) => this.post<FormDetail>(`/api/forms/${encodeURIComponent(id)}/publish`);
  close = (id: string) => this.post<FormDetail>(`/api/forms/${encodeURIComponent(id)}/close`);
  reopen = (id: string) => this.post<FormDetail>(`/api/forms/${encodeURIComponent(id)}/reopen`);
  deleteForm = (id: string) => this.del(`/api/forms/${encodeURIComponent(id)}`);

  // responses
  listResponses = (id: string, page: number, pageSize: number) =>
    this.get<ResponsePage>(`/api/forms/${encodeURIComponent(id)}/responses`, new HttpParams().set('page', page).set('pageSize', pageSize));
  getResponse = (id: string, responseId: string) =>
    this.get<ResponseDetail>(`/api/forms/${encodeURIComponent(id)}/responses/${encodeURIComponent(responseId)}`);
  deleteResponse = (id: string, responseId: string) =>
    this.del(`/api/forms/${encodeURIComponent(id)}/responses/${encodeURIComponent(responseId)}`);
  exportCsv = (id: string) =>
    this.call(firstValueFrom(this.http.get(`/api/forms/${encodeURIComponent(id)}/responses/export.csv`, { responseType: 'blob', observe: 'response' })));

  // public
  publicForm = (publicId: string) => this.get<PublicForm>(`/api/public/forms/${encodeURIComponent(publicId)}`);
  submit = (publicId: string, version: number, answers: Answers, website: string) =>
    this.post<{ number: number }>(`/api/public/forms/${encodeURIComponent(publicId)}/responses`, { version, answers, website });
}

export const publicUrl = (publicId: string) => `${location.origin}/f/${publicId}`;
