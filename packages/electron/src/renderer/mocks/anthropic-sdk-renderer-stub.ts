/**
 * Renderer stub for `@anthropic-ai/sdk`. Aliased in electron.vite.config.ts.
 *
 * The renderer never actually invokes the Anthropic SDK -- model listing now
 * uses direct `fetch` (see runtime/src/ai/models.ts) and every other AI call
 * goes through the main process. But `@anthropic-ai/sdk@0.97+` ships an
 * `agent-toolset/` submodule and `lib/tools/SessionToolRunner` that import
 * `node:fs` / `node:crypto` -- those bring the renderer build to a halt.
 *
 * This file provides the minimum surface (default class, error classes,
 * helpers) so any renderer code that *imports* the SDK compiles cleanly.
 * Calling into the class throws -- if a future change starts using the SDK
 * from the renderer, that will surface as a loud runtime error pointing
 * back here, not a silent miscompilation.
 */

const renderer = (): never => {
  throw new Error(
    '@anthropic-ai/sdk is stubbed in the Electron renderer. AI calls go through the main process.'
  );
};

class _NoopResource {
  list = () => Promise.resolve({ data: [] });
  create = () => renderer();
  retrieve = () => renderer();
  delete = () => renderer();
}

export class Anthropic {
  models = new _NoopResource();
  messages: any = {
    create: () => renderer(),
    stream: () => renderer(),
    countTokens: () => renderer(),
    toolRunner: () => renderer(),
  };
  completions = new _NoopResource();
  beta: any = {
    messages: { create: () => renderer(), toolRunner: () => renderer() },
    sessions: { events: { create: () => renderer(), list: () => renderer() } },
  };
  constructor(_opts?: any) { /* no-op */ }
}

export default Anthropic;
export const BaseAnthropic = Anthropic;
export const HUMAN_PROMPT = '';
export const AI_PROMPT = '';

export class AnthropicError extends Error {}
export class APIError extends AnthropicError {}
export class APIConnectionError extends APIError {}
export class APIConnectionTimeoutError extends APIConnectionError {}
export class APIUserAbortError extends APIError {}
export class NotFoundError extends APIError {}
export class ConflictError extends APIError {}
export class RateLimitError extends APIError {}
export class BadRequestError extends APIError {}
export class AuthenticationError extends APIError {}
export class InternalServerError extends APIError {}
export class PermissionDeniedError extends APIError {}
export class UnprocessableEntityError extends APIError {}

export class APIPromise<T> extends Promise<T> {}
export class PagePromise<T> extends Promise<T> {}

export const toFile = async (_input: any) => ({});
