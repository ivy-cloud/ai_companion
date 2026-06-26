/**
 * Fetch and cache generated singing audio from the backend.
 */

export function resolveSingingAudioUrl(apiBase: string, pathOrUrl: string): string {
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
    return pathOrUrl;
  }
  const base = apiBase.replace(/\/$/, '');
  const path = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${base}${path}`;
}

export async function fetchSingingAudioBuffer(
  apiBase: string,
  pathOrUrl: string,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const url = resolveSingingAudioUrl(apiBase, pathOrUrl);
  const response = await fetch(url, { method: 'GET', signal });
  if (!response.ok) {
    throw new Error(`Singing audio failed (${response.status})`);
  }
  return response.arrayBuffer();
}
