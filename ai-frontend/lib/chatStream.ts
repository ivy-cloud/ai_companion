/**
 * NDJSON chat stream from POST /chat — XHR on native (reliable progress), fetch on web.
 */

import { Platform } from 'react-native';
import { createAbortError, isAbortError } from './abortError';

export type StreamHandlers = {
  onStart?: (meta?: ChatStreamStartMeta) => void;
  onText: (chunk: string) => void;
  onDone: (reply: string) => string;
  onError: (message: string) => void;
};

import type { RhythmMeta } from './conversationOrchestration';

export type ChatStreamStartMeta = {
  timezone?: string;
  timezone_from_device?: boolean;
  rhythm?: RhythmMeta;
};

export type ChatLink = {
  title: string;
  url: string;
};

export type ChatStreamDoneMeta = {
  emotion_hint?: string;
  express_style?: string;
  speech_chunks?: string[];
  speech_reply?: string;
  links?: ChatLink[];
  singing?: boolean;
  singing_audio_url?: string;
  proactive?: boolean;
  proactive_beats?: string[];
};

type StreamEvent =
  | ({ start: true } & ChatStreamStartMeta)
  | { text: string }
  | { singing_generating: true }
  | ({
      done: true;
      reply: string;
      speech_reply?: string;
      links?: ChatLink[];
    } & ChatStreamDoneMeta)
  | { error: string };

export type ChatStreamHandlers = StreamHandlers & {
  onDoneMeta?: (meta: ChatStreamDoneMeta) => void;
  onSingingGenerating?: () => void;
};

function buildDoneMeta(event: Extract<StreamEvent, { done: true }>): ChatStreamDoneMeta {
  const meta: ChatStreamDoneMeta = {};
  if (event.emotion_hint) meta.emotion_hint = event.emotion_hint;
  if (event.express_style) meta.express_style = event.express_style;
  if (event.speech_chunks?.length) meta.speech_chunks = event.speech_chunks;
  if (event.speech_reply) meta.speech_reply = event.speech_reply;
  if (event.links?.length) meta.links = event.links;
  if (event.singing) meta.singing = true;
  if (event.singing_audio_url) meta.singing_audio_url = event.singing_audio_url;
  if (event.proactive) meta.proactive = true;
  if (event.proactive_beats?.length) meta.proactive_beats = event.proactive_beats;
  return meta;
}

function hasDoneMeta(meta: ChatStreamDoneMeta): boolean {
  return Boolean(
    meta.emotion_hint ||
      meta.express_style ||
      meta.speech_chunks?.length ||
      meta.speech_reply ||
      meta.links?.length ||
      meta.singing ||
      meta.singing_audio_url ||
      meta.proactive ||
      meta.proactive_beats?.length,
  );
}

function dispatchStreamEvent(event: StreamEvent, handlers: StreamHandlers): string | null {
  const streamHandlers = handlers as ChatStreamHandlers;
  if ('start' in event && event.start) {
    handlers.onStart?.({
      timezone: event.timezone,
      timezone_from_device: event.timezone_from_device,
      rhythm: event.rhythm,
    });
  }
  if ('singing_generating' in event && event.singing_generating) {
    streamHandlers.onSingingGenerating?.();
  }
  if ('text' in event && event.text) {
    handlers.onText(event.text);
  }
  if ('error' in event && event.error) {
    handlers.onError(event.error);
    throw new Error(event.error);
  }
  if ('done' in event && event.done) {
    const meta = buildDoneMeta(event);
    if (hasDoneMeta(meta)) {
      streamHandlers.onDoneMeta?.(meta);
    }
    return handlers.onDone(event.reply);
  }
  return null;
}

const STREAM_TIMEOUT_MS = 180_000;

export type ChatRequestBody = {
  message: string;
  timezone?: string;
  proactive?: boolean;
  thread_beat?: string;
  companion_interrupt?: boolean;
};

export type ChatRequestOptions = {
  proactive?: boolean;
  threadBeat?: string;
  companionInterrupt?: boolean;
};

function buildChatRequestBody(
  message: string,
  timezone?: string,
  options?: ChatRequestOptions,
): string {
  const body: ChatRequestBody = { message };
  if (timezone) body.timezone = timezone;
  if (options?.proactive) body.proactive = true;
  if (options?.threadBeat) body.thread_beat = options.threadBeat;
  if (options?.companionInterrupt) body.companion_interrupt = true;
  return JSON.stringify(body);
}

function parseNdjsonLines(buffer: string): { events: StreamEvent[]; rest: string } {
  const lines = buffer.split('\n');
  const rest = lines.pop() ?? '';
  const events: StreamEvent[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as StreamEvent);
    } catch {
      // partial line
    }
  }

  return { events, rest };
}

/** Apply events; return final reply only when a `done` line arrives. */
function processStreamEvents(events: StreamEvent[], handlers: StreamHandlers): string | null {
  let full = '';

  for (const event of events) {
    if ('text' in event && event.text) {
      full += event.text;
    }
    const doneReply = dispatchStreamEvent(event, handlers);
    if (doneReply !== null) {
      return doneReply || full;
    }
  }

  return null;
}

export function streamChatWithXHR(
  apiUrl: string,
  message: string,
  handlers: StreamHandlers,
  signal?: AbortSignal,
  timezone?: string,
  extraHeaders?: Record<string, string>,
  requestOptions?: ChatRequestOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const xhr = new XMLHttpRequest();
    let lastLength = 0;
    let buffer = '';
    let full = '';
    let completed = false;
    let lastProgressAt = Date.now();
    let singingGenerationActive = false;
    const stallMs = () => (singingGenerationActive ? 150_000 : 45_000);

    const finish = (fn: () => void) => {
      signal?.removeEventListener('abort', onAbort);
      clearTimeout(timeoutId);
      clearInterval(stallCheckId);
      fn();
    };

    const onAbort = () => {
      xhr.abort();
      finish(() => reject(createAbortError()));
    };

    signal?.addEventListener('abort', onAbort);

    const timeoutId = setTimeout(() => {
      xhr.abort();
      finish(() => reject(new Error('Request timed out — check backend and Ollama')));
    }, STREAM_TIMEOUT_MS);

    const stallCheckId = setInterval(() => {
      if (completed) return;
      if (Date.now() - lastProgressAt > stallMs()) {
        xhr.abort();
        finish(() =>
          reject(new Error('Stream stalled — try again or check Ollama is running')),
        );
      }
    }, 5000);

    const drainBuffer = (final = false) => {
      if (final && buffer.trim()) {
        buffer += '\n';
      }
      const { events, rest } = parseNdjsonLines(buffer);
      buffer = rest;

      for (const event of events) {
        if ('text' in event && event.text && !completed) {
          full += event.text;
        }
        if ('error' in event && event.error) {
          try {
            handlers.onError(event.error);
          } catch {
            // Never let UI handlers break the transport promise.
          }
          finish(() => reject(new Error(event.error)));
          return;
        }
        if ('singing_generating' in event && event.singing_generating) {
          singingGenerationActive = true;
          lastProgressAt = Date.now();
          (handlers as ChatStreamHandlers).onSingingGenerating?.();
        }
        if ('start' in event && event.start) {
          handlers.onStart?.({
            timezone: event.timezone,
            timezone_from_device: event.timezone_from_device,
            rhythm: event.rhythm,
          });
        }
        if ('text' in event && event.text && !completed) {
          handlers.onText(event.text);
        }
        if ('done' in event && event.done) {
          if (completed) return;
          completed = true;
          const meta = buildDoneMeta(event);
          if (hasDoneMeta(meta)) {
            (handlers as ChatStreamHandlers).onDoneMeta?.(meta);
          }
          const reply = handlers.onDone(event.reply || full);
          finish(() => resolve(reply));
          return;
        }
      }
    };

    xhr.open('POST', apiUrl);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Accept', 'application/x-ndjson');
    if (extraHeaders) {
      for (const [key, value] of Object.entries(extraHeaders)) {
        xhr.setRequestHeader(key, value);
      }
    }
    xhr.timeout = STREAM_TIMEOUT_MS;

    xhr.onprogress = () => {
      lastProgressAt = Date.now();
      const chunk = xhr.responseText.slice(lastLength);
      lastLength = xhr.responseText.length;
      if (!chunk) return;
      buffer += chunk;
      drainBuffer();
    };

    xhr.onreadystatechange = () => {
      if (xhr.readyState !== XMLHttpRequest.DONE || completed) return;
      lastProgressAt = Date.now();
      const tail = xhr.responseText.slice(lastLength);
      if (tail) {
        lastLength = xhr.responseText.length;
        buffer += tail;
        drainBuffer(true);
      }
    };

    xhr.onload = () => {
      if (signal?.aborted) {
        finish(() => reject(createAbortError()));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        finish(() => reject(new Error(xhr.responseText || `Request failed (${xhr.status})`)));
        return;
      }
      const tail = xhr.responseText.slice(lastLength);
      if (tail) buffer += tail;
      drainBuffer(true);
      if (!completed) {
        finish(() => reject(new Error('Stream ended without a complete reply')));
      }
    };

    xhr.onerror = () => {
      finish(() => reject(new Error('Network request failed — is the backend reachable?')));
    };

    xhr.ontimeout = () => {
      finish(() => reject(new Error('Request timed out — check backend and Ollama')));
    };

    xhr.send(buildChatRequestBody(message, timezone, requestOptions));
  });
}

export async function streamChatWithFetch(
  apiUrl: string,
  message: string,
  handlers: StreamHandlers,
  signal?: AbortSignal,
  timezone?: string,
  extraHeaders?: Record<string, string>,
  requestOptions?: ChatRequestOptions,
): Promise<string> {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/x-ndjson',
      ...extraHeaders,
    },
    body: buildChatRequestBody(message, timezone, requestOptions),
    signal,
  });

  if (!response.ok) {
    throw new Error((await response.text()) || `Request failed (${response.status})`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('ReadableStream not available');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseNdjsonLines(buffer);
    buffer = rest;

    const reply = processStreamEvents(events, handlers);
    if (reply !== null) return reply;
  }

  if (buffer.trim()) {
    const { events } = parseNdjsonLines(buffer + '\n');
    const reply = processStreamEvents(events, handlers);
    if (reply !== null) return reply;
  }

  throw new Error('Stream ended without a complete reply');
}

export async function streamChatMessage(
  apiUrl: string,
  message: string,
  handlers: StreamHandlers,
  signal?: AbortSignal,
  timezone?: string,
  extraHeaders?: Record<string, string>,
  requestOptions?: ChatRequestOptions,
): Promise<string> {
  // React Native fetch often buffers the full body; XHR onprogress streams reliably.
  if (Platform.OS !== 'web') {
    return streamChatWithXHR(
      apiUrl,
      message,
      handlers,
      signal,
      timezone,
      extraHeaders,
      requestOptions,
    );
  }

  try {
    return await streamChatWithFetch(
      apiUrl,
      message,
      handlers,
      signal,
      timezone,
      extraHeaders,
      requestOptions,
    );
  } catch (err) {
    if (isAbortError(err)) {
      throw err;
    }
    return streamChatWithXHR(
      apiUrl,
      message,
      handlers,
      signal,
      timezone,
      extraHeaders,
      requestOptions,
    );
  }
}
