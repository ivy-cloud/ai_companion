/**
 * Voice turn debug log — every event goes to:
 *   1) Metro console ([voice] …)
 *   2) Backend session log (POST /debug/voice-log → data/session_log.jsonl)
 *
 * View on Mac (phone testing):
 *   tail -f ai-backend/data/session_log.jsonl
 *   curl -s 'http://127.0.0.1:8000/debug/session-log?limit=80&format=text'
 */

import { Platform } from 'react-native';

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? 'http://192.168.0.178:8000';

export type VoiceLogDetail = Record<
  string,
  string | number | boolean | null | undefined
>;

let activeTurn = 0;
let activeGen = 0;
let seq = 0;

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

/** Always logs (not gated on __DEV__). */
export function voiceLog(event: string, detail?: VoiceLogDetail): void {
  seq += 1;
  const payload: VoiceLogDetail = {
    seq,
    turn: activeTurn,
    gen: activeGen,
    platform: Platform.OS,
    ...detail,
  };
  const parts = Object.entries(payload)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${v}`);
  console.log(`[voice] ${event} ${parts.join(' ')}`);

  void fetch(`${API_BASE}/debug/voice-log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event,
      detail: payload,
      platform: Platform.OS,
    }),
  }).catch(() => {});
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
