import type { DevModeStatus } from './healthPreflight';

export type HealthDetails = {
  reachable: boolean;
  status: 'ok' | 'degraded' | 'unknown';
  hint: string | null;
  companionName: string | null;
  skillHints: string[];
  llmProvider: string | null;
  model: string | null;
  modelReady: boolean | null;
  azureTtsReady: boolean | null;
  azureTtsVoice: string | null;
  localTime: string | null;
  devMode: DevModeStatus | null;
  sessionLogPath: string | null;
};

export async function fetchHealthDetails(apiBase: string): Promise<HealthDetails> {
  const empty: HealthDetails = {
    reachable: false,
    status: 'unknown',
    hint: `Can't reach backend (${apiBase}) — start server & same Wi‑Fi`,
    companionName: null,
    skillHints: [],
    llmProvider: null,
    model: null,
    modelReady: null,
    azureTtsReady: null,
    azureTtsVoice: null,
    localTime: null,
    devMode: null,
    sessionLogPath: null,
  };
  try {
    const response = await fetch(`${apiBase}/health`, { method: 'GET' });
    if (!response.ok) {
      return {
        ...empty,
        reachable: true,
        status: 'degraded',
        hint: `Backend returned ${response.status} — check server at ${apiBase}`,
      };
    }
    const data = (await response.json()) as {
      status?: string;
      hint?: string;
      companion?: { name?: string; skill_hints?: string[] };
      llm_provider?: string;
      model?: string;
      model_ready?: boolean;
      local_time?: string;
      azure_tts?: { ready?: boolean; voice_label?: string; voice?: string };
      dev_mode?: DevModeStatus;
      session_log?: { path?: string };
    };
    const hints = data.companion?.skill_hints;
    return {
      reachable: true,
      status: data.status === 'ok' ? 'ok' : 'degraded',
      hint: typeof data.hint === 'string' && data.hint.trim() ? data.hint : null,
      companionName: data.companion?.name?.trim() || null,
      skillHints: Array.isArray(hints) ? hints.filter((h) => typeof h === 'string') : [],
      llmProvider: data.llm_provider ?? null,
      model: data.model ?? null,
      modelReady: typeof data.model_ready === 'boolean' ? data.model_ready : null,
      azureTtsReady:
        typeof data.azure_tts?.ready === 'boolean' ? data.azure_tts.ready : null,
      azureTtsVoice: data.azure_tts?.voice_label ?? data.azure_tts?.voice ?? null,
      localTime: data.local_time ?? null,
      devMode: data.dev_mode ?? null,
      sessionLogPath: data.session_log?.path ?? null,
    };
  } catch {
    return empty;
  }
}
