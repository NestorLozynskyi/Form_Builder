import { Answers, FormSchema } from '../schema/form-schema';

export type FormStatus = 'draft' | 'published' | 'closed';

export interface User {
  email: string;
}

export interface FormSummary {
  id: string;
  title: string;
  status: FormStatus;
  liveVersion: number | null;
  hasUnpublishedChanges: boolean;
  responseCount: number;
  updatedAt: string;
  publicId: string | null;
}

export interface VersionInfo {
  number: number;
  publishedAt: string;
  responseCount: number;
}

export interface FormDetail extends FormSummary {
  draft: FormSchema;
  liveSchema: FormSchema | null;
  publishBlocker: string | null;
  versions: VersionInfo[];
  createdAt: string;
}

export interface ResponseItem {
  id: string;
  number: number;
  submittedAt: string;
  version: number;
  answers: Answers;
}

export interface ResponsePage {
  total: number;
  page: number;
  pageSize: number;
  items: ResponseItem[];
}

export interface ResponseDetail extends ResponseItem {
  schema: FormSchema;
  index: number;
  total: number;
  prevId: string | null;
  nextId: string | null;
  /** fields of this response's version missing from the live version → first version without them */
  removedIn: Record<string, number>;
}

export type PublicForm =
  | { publicId: string; status: 'open'; version: number; schema: FormSchema }
  | { publicId: string; status: 'closed'; title: string; accent: string };

/** RFC 9457 problem as returned by the API. */
export interface Problem {
  status?: number;
  title?: string;
  detail?: string;
  errors?: Record<string, string[]>;
}
