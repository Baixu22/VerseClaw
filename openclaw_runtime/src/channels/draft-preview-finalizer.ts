/**
 * Deprecated draft preview finalizer facade.
 *
 * Forwards legacy draft-preview callers to live preview finalization helpers.
 */
import type {
  LivePreviewFinalizerDraft,
  LivePreviewFinalizerResultKind,
} from "./message/live.js";

/**
 * @deprecated Use `LivePreviewFinalizerDraft` from `openclaw/plugin-sdk/channel-outbound`.
 */
export type DraftPreviewFinalizerDraft<TId> = LivePreviewFinalizerDraft<TId>;

/**
 * @deprecated Use `LivePreviewFinalizerResult` from `openclaw/plugin-sdk/channel-outbound`.
 */
export type DraftPreviewFinalizerResult = Exclude<
  LivePreviewFinalizerResultKind,
  "preview-retained"
>;
