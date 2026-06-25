/** Parse and merge tappable links for chat bubbles. */

export type ChatLink = {
  title: string;
  url: string;
};

const HTTPS_URL = /https:\/\/[^\s\)\]>]+/gi;

/** Extract unique https URLs from plain text. */
export function parseUrlsInText(text: string): string[] {
  const matches = text.match(HTTPS_URL) ?? [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const raw of matches) {
    const url = raw.replace(/[.,;:!?]+$/, '');
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(url);
  }
  return urls;
}

/** Merge server-provided links with any URLs embedded in the reply text. */
export function mergeChatLinks(links: ChatLink[] | undefined, text: string): ChatLink[] {
  const merged: ChatLink[] = [];
  const seen = new Set<string>();

  for (const link of links ?? []) {
    const url = link.url?.trim();
    if (!url.startsWith('https://')) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      title: (link.title?.trim() || url).slice(0, 120),
      url,
    });
  }

  for (const url of parseUrlsInText(text)) {
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    let title = url.replace(/^https?:\/\//, '');
    const slash = title.indexOf('/');
    if (slash > 0) title = title.slice(0, slash);
    merged.push({ title: title.slice(0, 120), url });
  }

  return merged.slice(0, 5);
}
