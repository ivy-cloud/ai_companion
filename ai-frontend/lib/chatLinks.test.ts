import { mergeChatLinks, parseUrlsInText } from './chatLinks';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`, e);
    process.exitCode = 1;
  }
}

test('parseUrlsInText finds https links', () => {
  const urls = parseUrlsInText('See https://example.com/page and https://other.org/x.');
  if (urls.length !== 2) throw new Error(JSON.stringify(urls));
  if (!urls[0].includes('example.com')) throw new Error(urls[0]);
});

test('parseUrlsInText dedupes', () => {
  const urls = parseUrlsInText('https://a.com https://a.com');
  if (urls.length !== 1) throw new Error(String(urls.length));
});

test('mergeChatLinks prefers server titles', () => {
  const merged = mergeChatLinks(
    [{ title: 'Weather', url: 'https://weather.example/' }],
    'Check https://weather.example/ tonight.',
  );
  if (merged.length !== 1) throw new Error(JSON.stringify(merged));
  if (merged[0].title !== 'Weather') throw new Error(merged[0].title);
});

test('mergeChatLinks adds inline urls', () => {
  const merged = mergeChatLinks([], 'Try https://docs.example/guide');
  if (merged.length !== 1) throw new Error(JSON.stringify(merged));
  if (!merged[0].url.includes('docs.example')) throw new Error(merged[0].url);
});
