/** Backend reachability and dev-mode hints before voice sessions. */

export type DevModeStatus = {
  active?: boolean;
  mock_llm?: boolean;
  mock_tts?: boolean;
  mock_stt?: boolean;
};

export type HealthPreflightResult = {
  reachable: boolean;
  status: 'ok' | 'degraded' | 'unknown';
  mockUnexpected: boolean;
  azureTtsReady: boolean | null;
  hint: string | null;
  devMode: DevModeStatus | null;
};

export function formatHealthBanner(result: HealthPreflightResult): string | null {
  if (!result.reachable) {
    return (
      result.hint ??
      "Can't reach the backend — start ./start.sh on your Mac and stay on the same Wi‑Fi."
    );
  }
  if (result.mockUnexpected) {
    return (
      'Backend is in test mode (mock AI/voice). For real Jessica, restart without DEV_MOCK_* — see DEV.md.'
    );
  }
  if (result.status === 'degraded' && result.hint) {
    return result.hint;
  }
  if (result.azureTtsReady === false) {
    return 'Azure speech is not configured — voice may be silent. Check ai-backend/.env.';
  }
  return null;
}

export async function fetchHealthPreflight(
  apiBase: string,
  options?: { expectRealVoice?: boolean },
): Promise<HealthPreflightResult> {
  const expectReal = options?.expectRealVoice !== false;
  try {
    const response = await fetch(`${apiBase}/health`, { method: 'GET' });
    if (!response.ok) {
      return {
        reachable: true,
        status: 'degraded',
        mockUnexpected: false,
        azureTtsReady: null,
        hint: `Backend returned ${response.status} — check server at ${apiBase}`,
        devMode: null,
      };
    }
    const data = (await response.json()) as {
      status?: string;
      hint?: string;
      dev_mode?: DevModeStatus;
      azure_tts?: { ready?: boolean; hint?: string };
    };
    const dev = data.dev_mode ?? null;
    const mockUnexpected = Boolean(
      expectReal &&
        dev &&
        (dev.mock_llm || dev.mock_tts || dev.mock_stt),
    );
    const azureReady =
      typeof data.azure_tts?.ready === 'boolean' ? data.azure_tts.ready : null;
    let hint: string | null = null;
    if (typeof data.hint === 'string' && data.hint.trim()) {
      hint = data.hint.length > 120 ? `${data.hint.slice(0, 117)}…` : data.hint;
    } else if (azureReady === false && data.azure_tts?.hint) {
      const h = data.azure_tts.hint;
      hint = h.length > 120 ? `${h.slice(0, 117)}…` : h;
    }
    return {
      reachable: true,
      status: data.status === 'ok' ? 'ok' : 'degraded',
      mockUnexpected,
      azureTtsReady: azureReady,
      hint,
      devMode: dev,
    };
  } catch {
    return {
      reachable: false,
      status: 'unknown',
      mockUnexpected: false,
      azureTtsReady: null,
      hint: `Can't reach backend (${apiBase}) — start server & same Wi‑Fi`,
      devMode: null,
    };
  }
}
