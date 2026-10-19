import type {
  HostApiAction,
  HostApiModule,
  HostApiPayload,
} from './contract';
import type { HostDeadline } from './host-deadline';

export type HostRequest = {
  id: string;
  module: string;
  action: string;
  payload?: unknown;
  /** NET-E (TF-0442): logical deadline propagated from the outermost layer. */
  deadline?: HostDeadline;
};

export type TypedHostRequest<
  M extends HostApiModule,
  A extends HostApiAction<M>,
> = {
  id: string;
  module: M;
  action: A;
  payload?: HostApiPayload<M, A>;
  /** NET-E (TF-0442): logical deadline propagated from the outermost layer. */
  deadline?: HostDeadline;
};

export type HostResponse<T = unknown> =
  | { id?: string; ok: true; data: T }
  | { id?: string; ok: false; error?: { code?: string; message?: string; details?: unknown } };
