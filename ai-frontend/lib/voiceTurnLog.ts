/**
 * Voice turn debug log — every event goes to:
 *   1) Metro console ([voice] …)
 *   2) Backend session log (POST /debug/voice-log → data/session_log.jsonl)
 *
 * Network posts are debounced/batched so high-frequency voice events do not block
 * the JS thread or flood the device during conversation mode.
 *
 * View on Mac (phone testing):
 *   tail -f ai-backend/data/session_log.jsonl
 *   curl -s 'http://127.0.0.1:8000/debug/session-log?limit=80&format=text'
 */

import { Platform } from 'react-native';

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? 'http://192.168.0.178:8000';

const FLUSH_MS = 450;
const MAX_QUEUE = 48;
/** Min gap between snapshot_* network posts (console still logs). */
export const SNAPSHOT_NETWORK_MIN_MS = 2000;
/** Collapse identical high-frequency events within this window. */
const DEDUPE_MS = 900;

export type VoiceLogDetail = Record<
  string,
  string | number | boolean | null | undefined
>;

type QueuedVoiceLog = {
  event: string;
  detail: VoiceLogDetail;
};

let activeTurn = 0;
let activeGen = 0;
let seq = 0;

let networkQueue: QueuedVoiceLog[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let lastSnapshotNetworkAt = 0;
let lastDedupeKey = '';
let lastDedupeAt = 0;

export function setVoiceLogContext(turn: number, generation?: number): void {
  activeTurn = turn;
  if (generation !== undefined) {
    activeGen = generation;
  }
}

export function bumpVoiceLogTurn(turn: number): void {
  activeTurn = turn;
  activeGen = 0;
}

export function bumpVoiceLogGeneration(generation: number): void {
  activeGen = generation;
}

function formatPayload(event: string, detail?: VoiceLogDetail): VoiceLogDetail {
  seq += 1;
  return {
    seq,
    turn: activeTurn,
    gen: activeGen,
    platform: Platform.OS,
    ...detail,
  };
}

function formatConsoleLine(event: string, payload: VoiceLogDetail): string {
  const parts = Object.entries(payload)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${v}`);
  return `[voice] ${event} ${parts.join(' ')}`;
}

function shouldEnqueueNetwork(event: string, detail?: VoiceLogDetail): boolean {
  if (event.startsWith('snapshot_')) {
    const now = Date.now();
    if (now - lastSnapshotNetworkAt < SNAPSHOT_NETWORK_MIN_MS) {
      return false;
    }
    lastSnapshotNetworkAt = now;
  }

  if (
    event === 'schedule_listen_blocked' ||
    event === 'listen_blocked' ||
    event === 'listen_open_grace'
  ) {
    const reason = detail?.reason ?? '';
    const key = `${event}:${reason}`;
    const now = Date.now();
    if (key === lastDedupeKey && now - lastDedupeAt < DEDUPE_MS) {
      return false;
    }
    lastDedupeKey = key;
    lastDedupeAt = now;
  }

  return true;
}

function scheduleNetworkFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushVoiceLogNetwork();
  }, FLUSH_MS);
}

function postVoiceLogEntry(entry: QueuedVoiceLog): void {
  void fetch(`${API_BASE}/debug/voice-log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: entry.event,
      detail: entry.detail,
      platform: Platform.OS,
    }),
  }).catch(() => {});
}

/** Flush pending network logs (e.g. on unmount). */
export function flushVoiceLogNetwork(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (networkQueue.length === 0) return;

  const batch = networkQueue.splice(0, networkQueue.length);
  if (batch.length === 1) {
    postVoiceLogEntry(batch[0]!);
    return;
  }

  postVoiceLogEntry({
    event: 'voice_log_batch',
    detail: {
      count: batch.length,
      first: batch[0]?.event,
      last: batch[batch.length - 1]?.event,
      events: batch.map((e) => e.event).join(','),
    },
  });
}

/** Always logs to console; network is debounced/batched/deduped. */
export function voiceLog(event: string, detail?: VoiceLogDetail): void {
  const payload = formatPayload(event, detail);
  console.log(formatConsoleLine(event, payload));

  if (!shouldEnqueueNetwork(event, detail)) {
    return;
  }

  networkQueue.push({ event, detail: payload });
  if (networkQueue.length >= MAX_QUEUE) {
    flushVoiceLogNetwork();
    return;
  }
  scheduleNetworkFlush();
}

export function voiceLogPhase(
  from: string,
  to: string,
  reason?: string,
): void {
  voiceLog('phase', { from, to, reason: reason ?? 'ok' });
}

export function voiceLogSnapshot(
  label: string,
  extra?: VoiceLogDetail,
): void {
  voiceLog(`snapshot_${label}`, extra);
}
