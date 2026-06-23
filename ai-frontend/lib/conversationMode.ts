import type { VoicePhase } from './conversationState';

/**
 * Semi-continuous voice session — silence end detection via recording metering.
 */

/** Silence after speech before auto-send (ms). Tunable — longer reduces cut-off mid-thought. */
export const SILENCE_END_MS = 1000;

/**
 * Extra patience when live transcript suggests distress or low mood (Hume patient turn-taking).
 */
export const SILENCE_END_PATIENT_MS = 1600;

/** Distress / low-mood cues — lightweight mirror of ai-backend/emotion.py (text only). */
const PATIENT_PACING_DISTRESS =
  /\b(?:sad|depressed|lonely|anxious|worried|scared|afraid|stressed|overwhelmed|hurting|hurt|cry(?:ing)?|grief|grieving|passed away|died|funeral|breakup|broke up|can't cope|hard day|rough day|not okay|not ok|exhausted|burnt out|burned out)\b/i;

const PATIENT_PACING_ZH =
  /(?:难过|伤心|焦虑|害怕|累|崩溃|分手|去世|孤独|沮丧|压力大)/;

/** True when we should wait longer before end-of-turn (empathic companion pacing). */
export function wantsPatientTurnPacing(liveTranscript: string): boolean {
  const trimmed = liveTranscript.trim();
  if (!trimmed) return false;
  return PATIENT_PACING_DISTRESS.test(trimmed) || PATIENT_PACING_ZH.test(trimmed);
}

/** Resolve silence threshold from rolling partial STT (if any). */
export function resolveSilenceEndMs(liveTranscript?: string | null): number {
  if (liveTranscript && wantsPatientTurnPacing(liveTranscript)) {
    return SILENCE_END_PATIENT_MS;
  }
  return SILENCE_END_MS;
}

/** Extra silence window once when STT ends on an incomplete-thought marker. */
export const SEMANTIC_TURN_EXTENSION_MS = 700;

/** Trailing words / fillers that suggest the user may continue (EN + common ZH). */
const INCOMPLETE_THOUGHT_ENDING =
  /\b(and|but|because|so|or|if|when|while|though|although|unless|until|since|like|um|uh|er|ah)\s*[,.]?\s*$/i;

const INCOMPLETE_THOUGHT_ENDING_ZH =
  /(因为|但是|然后|所以|而且|不过|如果|虽然|可是|或者|还有|就是|那个|这个|嗯|啊|呃)\s*$/;

/** True when transcript likely trails off mid-thought — extend listen once before send. */
export function hasIncompleteThoughtEnding(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return (
    INCOMPLETE_THOUGHT_ENDING.test(trimmed) ||
    INCOMPLETE_THOUGHT_ENDING_ZH.test(trimmed)
  );
}

/** Join buffered partial utterance with the next STT chunk. */
export function combineUtteranceTranscripts(
  prefix: string,
  next: string,
): string {
  const a = prefix.trim();
  const b = next.trim();
  if (!a) return b;
  if (!b) return a;
  return `${a} ${b}`.replace(/\s+/g, ' ').trim();
}

/** Minimum time above speech threshold before silence can trigger send. */
export const MIN_SPEECH_MS = 350;

/** Extra tail captured after silence detected — reduces clipped last syllables. */
export const RECORDING_TAIL_MS = 180;

/** End conversation session after this much idle time (ms). */
export const SESSION_INACTIVITY_MS = 60_000;

/** How often to poll recording levels. */
export const METERING_INTERVAL_MS = 120;

/** Sustained user speech before voice barge-in fires (ms). ~Hume min_interruption_ms default (800). */
export const BARGE_IN_MIN_SPEECH_MS = 750;

/** Ignore metering briefly after barge-in monitor starts (thinking). */
export const BARGE_IN_GRACE_MS = 600;

/** Extra grace when TTS starts — reduces false triggers from speaker bleed. */
export const BARGE_IN_TTS_GRACE_MS = 1800;

/**
 * Stricter than {@link SPEECH_LEVEL_DB} for barge-in — avoids speaker bleed / room noise.
 */
export const BARGE_IN_SPEECH_LEVEL_DB = -42;

/** After a barge-in interrupt, ignore further triggers for this long (ms). */
export const BARGE_IN_COOLDOWN_MS = 2000;

/**
 * Brief delay after TTS ends before opening the mic — room echo decay only.
 * Listen is blocked while activeSound/drain/queue remain; STT echo uses
 * isLikelyAssistantEchoTranscript once the recorder is open.
 */
/** Brief cooldown before scheduling listen after TTS ends (ms). */
export const POST_TTS_LISTEN_COOLDOWN_MS = 150;

/** Brief post-TTS window — mic may still pick up speaker tail before echo decay. */
export const POST_TTS_ECHO_GRACE_MS = 400;

/** iOS "Only one Recording" storm — suppress watchdog reset while failures cluster. */
export const ONLY_ONE_STORM_COOLDOWN_MS = 5000;

export function isOnlyOneRecordingStorm(
  consecutiveFailures: number,
  msSinceLastFailure: number,
): boolean {
  return (
    consecutiveFailures >= 2 && msSinceLastFailure < ONLY_ONE_STORM_COOLDOWN_MS
  );
}

/** Retry cadence when listen is temporarily blocked by TTS/drain/in-flight states. */
export const LISTEN_RETRY_MS = 180;

/** Recover when Listening… with no mic or blocked meter for this long (safety only). */
export const LISTENING_STUCK_MS = 6500;

/**
 * Idle "Opening mic…" with a pending schedule_listen but no recorder — force recovery.
 * Uses lastListenScheduleAt (preserved across LISTEN_RETRY_MS), not phaseChangedAt.
 */
export const OPENING_MIC_STUCK_MS = 5500;

/** Max time for ensureListenChain mic-open work (release + iOS mode + recorder). */
export const MIC_OPEN_CHAIN_TIMEOUT_MS = 12_000;

/** Meter may bail while TTS refs are stale — reopen listen after this (ms). */
export const LISTEN_METER_BLOCKED_MS = 2200;

/**
 * Grace after entering listening before treating "no recorder" as stuck.
 * Mic open is async; forcing idle too early caused listen ↔ idle ↔ interrupt flicker.
 */
export const LISTEN_OPEN_GRACE_MS = 800;

/** Minimum gap between non-retry schedule_listen calls (coalesces rapid reopen). */
export const MIN_SCHEDULE_LISTEN_MS = 180;

/** Recover an active conversation when phase idles with no pending listen reopen. */
export const IDLE_LISTEN_RECOVERY_MS = 2800;

/**
 * Idle + session stuck longer than this — recover even if a listen timer is pending.
 * Retry timers alone can thrash without opening the mic (blocked TTS / stale in-flight).
 */
export const LISTEN_PAUSED_STUCK_MS = 7000;

/** Do not repeat the same watchdog listen recovery within this window. */
export const WATCHDOG_RECOVERY_COOLDOWN_MS = 8000;

/** Idle listen with no user speech before a proactive companion turn (ms). */
export const PROACTIVE_IDLE_MS = 10_000;

/** Minimum gap between proactive turns (ms). */
export const PROACTIVE_MIN_GAP_MS = 20_000;

/** Max proactive turns per session without user speech. */
export const PROACTIVE_MAX_PER_SESSION = 3;

/** Window for detecting rapid phase flips (voiceLog diagnostic). */
export const PHASE_OSCILLATION_WINDOW_MS = 2500;

/** Phase transitions in window that trigger phase_oscillation log. */
export const PHASE_OSCILLATION_MAX_FLIPS = 5;

/** After oscillation is detected, slow listen reschedule (ms). */
export const PHASE_OSCILLATION_COOLDOWN_MS = 4000;

/** Max schedule_listen retries before giving up until next successful open. */
export const MAX_LISTEN_SCHEDULE_RETRIES = 48;

/** Upper bound for listen retry delay after many failures (~13s at 280ms base). */
export const LISTEN_RETRY_MAX_DELAY_MS = 2000;

/**
 * True when listening has no recorder long enough to force idle / watchdog recovery.
 */
export function shouldForceIdleListeningWithoutRecording(
  msInListeningPhase: number,
  hasRecording: boolean,
): boolean {
  if (hasRecording) return false;
  return msInListeningPhase >= LISTEN_OPEN_GRACE_MS;
}

/** True when the listen meter has been TTS-blocked long enough to force recovery. */
export function shouldRecoverListeningMeterBlocked(
  blockedMs: number,
  ttsBlocked: boolean,
): boolean {
  return ttsBlocked && blockedMs >= LISTEN_METER_BLOCKED_MS;
}

/**
 * True when conversation session shows "Listening paused" (idle) long enough to force reopen.
 */
export function shouldRecoverListenPausedStuck(
  stuckMs: number,
  hasPendingListenTimer: boolean,
): boolean {
  if (stuckMs < IDLE_LISTEN_RECOVERY_MS) return false;
  if (!hasPendingListenTimer) return true;
  return stuckMs >= LISTEN_PAUSED_STUCK_MS;
}

/** True when schedule_listen fired but mic never opened within OPENING_MIC_STUCK_MS. */
export function shouldRecoverOpeningMicStuck(
  lastScheduleListenAt: number | null,
  nowMs: number,
  thresholdMs = OPENING_MIC_STUCK_MS,
): boolean {
  if (lastScheduleListenAt == null) return false;
  return nowMs - lastScheduleListenAt >= thresholdMs;
}

/**
 * Expo metering is dBFS (negative). Above this ≈ speech; below ≈ silence.
 * Lower (more negative) picks up quieter speech at arm's length on phone mics;
 * also raises false triggers from room noise / HVAC — do not go below ~-62 without testing.
 */
export const SPEECH_LEVEL_DB = -60;

/**
 * Quieter than {@link SPEECH_LEVEL_DB} but still visible on the dB bar — counts as sawSpeech
 * so end_silence can fire after the user stops (fixes bar-moving-but-never-responds).
 */
export const METER_SPEECH_LEVEL_DB = -74;

/**
 * After speech, treat metering at or below (peak − this) as trailing silence even when
 * still above {@link SPEECH_LEVEL_DB} (room noise / HVAC was blocking end_silence).
 */
export const SILENCE_DROP_FROM_PEAK_DB = 6;

/** Sustained user speech before companion gently jumps in (ms). Friend-like, not passive. */
export const INTERRUPT_USER_SPEECH_MS = 20_000;

/** Minimum speech before companion interrupt — avoids cutting in on brief noise. */
export const MIN_SPEECH_BEFORE_INTERRUPT_MS = 2_800;

/** Brief spoken ack when companion interrupts a long monologue (friend energy). */
export const COMPANION_INTERRUPT_ACKS = [
  'Wait wait—',
  'Oh— hang on—',
  'Hold on—',
  'Right—',
  'Can I jump in?',
  'Oh wait—',
] as const;

/** Pick a stable interrupt ack from speech duration (same monologue → same phrase). */
export function pickCompanionInterruptAck(speechMs: number): string {
  const idx = Math.floor(speechMs / 1000) % COMPANION_INTERRUPT_ACKS.length;
  return COMPANION_INTERRUPT_ACKS[idx]!;
}

/**
 * True when sustained speech exceeds interrupt threshold and patient pacing does not apply.
 */
export function shouldCompanionInterruptUser(
  speechMs: number,
  liveTranscript?: string | null,
  options?: { backendHint?: boolean },
): boolean {
  if (speechMs < MIN_SPEECH_BEFORE_INTERRUPT_MS) return false;
  let thresholdMs = INTERRUPT_USER_SPEECH_MS;
  const words = liveTranscript?.trim().split(/\s+/).filter(Boolean).length ?? 0;
  if (options?.backendHint) {
    thresholdMs = Math.min(thresholdMs, 7_000);
  }
  if (words >= 45) {
    thresholdMs = Math.min(thresholdMs, 6_000);
  } else if (words >= 22) {
    thresholdMs = Math.min(thresholdMs, 9_000);
  } else if (words >= 15) {
    thresholdMs = Math.min(thresholdMs, 12_000);
  }
  if (speechMs < thresholdMs) return false;
  if (liveTranscript && wantsPatientTurnPacing(liveTranscript)) return false;
  return true;
}

/** Hard cap — force commit even without a clean silence gap (after companion interrupt window). */
export const MAX_UTTERANCE_MS = 45_000;

/** Log hint when listening this long with no meter speech (quiet_voice_timeout). */
export const QUIET_VOICE_TIMEOUT_MS = 5000;

/** Peak at or below this during a listen cycle = quiet speech (second-chance STT retry). */
export const QUIET_SPEECH_PEAK_MAX_DB = -50;

export function isSpeechLevel(metering?: number): boolean {
  if (metering === undefined || metering === null || Number.isNaN(metering)) {
    return false;
  }
  return metering > SPEECH_LEVEL_DB;
}

/** True when metering should mark sawSpeech (includes quiet speech visible on dB bar). */
export function isMeterSpeech(metering?: number): boolean {
  if (metering === undefined || metering === null || Number.isNaN(metering)) {
    return false;
  }
  return metering > METER_SPEECH_LEVEL_DB;
}

/**
 * True when user has likely stopped speaking — absolute silence or level dropped from peak.
 */
export function isSilenceForEndDetection(
  metering: number | undefined,
  peakMetering: number | null,
): boolean {
  if (!isMeterSpeech(metering)) {
    return true;
  }
  if (!isSpeechLevel(metering)) {
    return true;
  }
  if (peakMetering === null) {
    return false;
  }
  return metering! <= peakMetering - SILENCE_DROP_FROM_PEAK_DB;
}

export function isBargeInSpeechLevel(metering?: number): boolean {
  if (metering === undefined || metering === null || Number.isNaN(metering)) {
    return false;
  }
  return metering > BARGE_IN_SPEECH_LEVEL_DB;
}

export type ConversationMeterState = {
  sawSpeech: boolean;
  speechStartedAt: number | null;
  silenceSince: number | null;
  listenStartedAt: number;
  lastSpeechAt: number | null;
  /** Max dBFS seen this listen cycle (for quiet-speech diagnostics). */
  peakMetering: number | null;
  quietVoiceTimeoutLogged: boolean;
};

export function createConversationMeterState(now = Date.now()): ConversationMeterState {
  return {
    sawSpeech: false,
    speechStartedAt: null,
    silenceSince: null,
    listenStartedAt: now,
    lastSpeechAt: null,
    peakMetering: null,
    quietVoiceTimeoutLogged: false,
  };
}

export type MeterTickResult = {
  state: ConversationMeterState;
  /** Enough speech + trailing silence — stop chunk and send. */
  endSilence: boolean;
  /** Sustained monologue — companion jumps in and commits partial utterance. */
  companionInterrupt: boolean;
  /** No speech for SESSION_INACTIVITY_MS — end session. */
  inactive: boolean;
  /** Listening with no sawSpeech for QUIET_VOICE_TIMEOUT_MS — log once. */
  quietVoiceTimeout: boolean;
  /** Ms of speech when endSilence or companionInterrupt fired (0 otherwise). */
  speechDurationMs: number;
  /** Ms of trailing silence when endSilence fired (0 otherwise). */
  silenceDurationMs: number;
};

export type QuietListenMeterMeta = {
  sawSpeech: boolean;
  peakMetering: number | null;
  speechDurationMs: number;
};

/** Second-chance listen when STT empty but meter saw brief quiet speech. */
export function shouldSecondChanceQuietListen(meta: QuietListenMeterMeta): boolean {
  if (!meta.sawSpeech || meta.peakMetering === null) return false;
  if (meta.speechDurationMs < MIN_SPEECH_MS) return false;
  return meta.peakMetering <= QUIET_SPEECH_PEAK_MAX_DB;
}

function nextPeakMetering(
  peak: number | null,
  metering: number | undefined,
): number | null {
  if (metering === undefined || metering === null || Number.isNaN(metering)) {
    return peak;
  }
  return peak === null ? metering : Math.max(peak, metering);
}

export type MeterTickOptions = {
  /** Override default {@link SILENCE_END_MS} — e.g. patient pacing from live partial STT. */
  silenceEndMs?: number;
  /** Rolling partial STT — distress extends silence and blocks companion interrupt. */
  liveTranscript?: string | null;
  /** False outside an active conversation session. */
  allowCompanionInterrupt?: boolean;
  /** Backend rhythm hint — user is on a long monologue. */
  companionInterruptHint?: boolean;
};

export function tickConversationMeter(
  state: ConversationMeterState,
  metering: number | undefined,
  now: number,
  options?: MeterTickOptions,
): MeterTickResult {
  const silenceEndMs = options?.silenceEndMs ?? SILENCE_END_MS;
  const peakMetering = nextPeakMetering(state.peakMetering, metering);
  const meterSpeech = isMeterSpeech(metering);
  const peakHeard =
    peakMetering !== null && peakMetering > METER_SPEECH_LEVEL_DB;
  const heardSpeech = meterSpeech || peakHeard || state.sawSpeech;
  const stillSpeaking =
    meterSpeech && !isSilenceForEndDetection(metering, peakMetering);

  if (stillSpeaking) {
    const speechStartedAt = state.speechStartedAt ?? now;
    const next: ConversationMeterState = {
      ...state,
      sawSpeech: true,
      speechStartedAt,
      silenceSince: null,
      lastSpeechAt: now,
      peakMetering,
    };
    const speechMs = now - speechStartedAt;
    const companionInterrupt =
      options?.allowCompanionInterrupt !== false &&
      shouldCompanionInterruptUser(speechMs, options?.liveTranscript, {
        backendHint: options?.companionInterruptHint === true,
      });
    const forceEnd = !companionInterrupt && speechMs >= MAX_UTTERANCE_MS;
    const fired = companionInterrupt || forceEnd;
    return {
      state: next,
      endSilence: forceEnd,
      companionInterrupt,
      inactive: false,
      quietVoiceTimeout: false,
      speechDurationMs: fired ? speechMs : 0,
      silenceDurationMs: 0,
    };
  }

  const silenceSince = state.silenceSince ?? now;
  const heardRealSpeech =
    state.sawSpeech &&
    state.peakMetering !== null &&
    state.peakMetering > SPEECH_LEVEL_DB;
  const quietVoiceTimeout =
    !heardRealSpeech &&
    !state.quietVoiceTimeoutLogged &&
    now - state.listenStartedAt >= QUIET_VOICE_TIMEOUT_MS;
  const next: ConversationMeterState = {
    ...state,
    sawSpeech: heardSpeech,
    speechStartedAt:
      state.speechStartedAt ?? (heardSpeech ? now : null),
    silenceSince,
    peakMetering,
    quietVoiceTimeoutLogged: state.quietVoiceTimeoutLogged || quietVoiceTimeout,
    lastSpeechAt: meterSpeech ? now : state.lastSpeechAt,
  };
  const speechMs =
    next.sawSpeech && next.speechStartedAt != null
      ? now - next.speechStartedAt
      : 0;
  const silenceMs = now - silenceSince;
  const endSilence =
    next.sawSpeech &&
    speechMs >= MIN_SPEECH_MS &&
    silenceMs >= silenceEndMs;
  const forceEnd = speechMs >= MAX_UTTERANCE_MS;
  const fired = endSilence || forceEnd;

  const anchor = state.lastSpeechAt ?? state.listenStartedAt;
  const inactive = now - anchor >= SESSION_INACTIVITY_MS;

  return {
    state: next,
    endSilence: fired,
    companionInterrupt: false,
    inactive,
    quietVoiceTimeout,
    speechDurationMs: fired ? speechMs : 0,
    silenceDurationMs: fired ? silenceMs : 0,
  };
}

export type BargeInMeterState = {
  speechStartedAt: number | null;
};

export function createBargeInMeterState(): BargeInMeterState {
  return { speechStartedAt: null };
}

/** Voice interrupt while assistant is thinking or speaking (conversation mode). */
export function tickConversationBargeIn(
  state: BargeInMeterState,
  metering: number | undefined,
  now: number,
  graceUntil: number,
): { state: BargeInMeterState; triggered: boolean } {
  if (now < graceUntil) {
    return { state: { speechStartedAt: null }, triggered: false };
  }

  if (!isBargeInSpeechLevel(metering)) {
    return { state: { speechStartedAt: null }, triggered: false };
  }

  const speechStartedAt = state.speechStartedAt ?? now;
  const triggered = now - speechStartedAt >= BARGE_IN_MIN_SPEECH_MS;
  return { state: { speechStartedAt }, triggered };
}

/**
 * Whether conversation listen can start (or restart) from the current phase.
 * When already listening with an active recorder, returns false (no-op).
 */
/** Don't open barge-in mic while final STT / send is in flight — races post-STT phase checks. */
export function shouldDeferBargeInForVoiceCommit(
  voiceSendLock: boolean,
  listenChunkCommitInFlight: boolean,
  ttsBlocking = false,
): boolean {
  return voiceSendLock || listenChunkCommitInFlight || ttsBlocking;
}

export function canResumeConversationListen(
  phase: VoicePhase,
  hasRecording: boolean,
  resumeAfterInterrupt: boolean,
): boolean {
  if (phase === 'listening' && hasRecording) {
    return false;
  }
  if (!resumeAfterInterrupt) {
    return phase === 'idle' || phase === 'speaking';
  }
  return (
    phase === 'idle' ||
    phase === 'speaking' ||
    phase === 'thinking' ||
    phase === 'streaming' ||
    phase === 'interrupting' ||
    (phase === 'listening' && !hasRecording)
  );
}
