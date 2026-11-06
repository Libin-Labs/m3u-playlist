import assert from 'node:assert/strict';
import { test } from 'node:test';
import { M3uError, classifyM3uLocation, formatM3u, parseM3u } from '../dist/esm/index.js';

// Layout follows the de-facto extended M3U convention (#EXTM3U / #EXTINF:<seconds>,<title>).
const SAMPLE = `#EXTM3U
#EXTINF:123,Sample artist - Sample title
C:\\Documents and Settings\\I\\My Music\\Sample.mp3
#EXTINF:321,Example Artist - Example title
https://example.com/stream/Example.ogg
#EXTINF:-1 tvg-id="ch1" group-title="News, Live",Channel One
http://host/live.m3u8?a=1,2
media/relative.flac
`;

test('parses extended entries, attributes with commas in quotes, and bare entries', () => {
  const list = parseM3u(SAMPLE);
  assert.equal(list.extended, true);
  assert.equal(list.entries.length, 4);
  assert.deepEqual(list.entries[0], {
    uri: 'C:\\Documents and Settings\\I\\My Music\\Sample.mp3',
    duration: 123,
    title: 'Sample artist - Sample title',
  });
  assert.deepEqual(list.entries[2], {
    uri: 'http://host/live.m3u8?a=1,2',
    duration: -1,
    title: 'Channel One',
    attributes: [
      { name: 'tvg-id', value: 'ch1' },
      { name: 'group-title', value: 'News, Live' },
    ],
  });
  assert.deepEqual(list.entries[3], { uri: 'media/relative.flac' });
});

test('plain M3U, BOM, CRLF, CR, blank lines, comments and HLS-style tags', () => {
  assert.deepEqual(parseM3u('a.mp3\r\n\r\n# comment\r\nb.mp3\r\n'), {
    extended: false,
    entries: [{ uri: 'a.mp3' }, { uri: 'b.mp3' }],
  });
  assert.equal(
    parseM3u('\uFEFF#EXTM3U\r#EXT-X-VERSION:3\r#EXTGRP:x\rfoo.ts\r').entries[0].uri,
    'foo.ts',
  );
  assert.deepEqual(parseM3u('  \n#EXTM3U\n  a.mp3  \n').entries, [{ uri: 'a.mp3' }]);
  assert.deepEqual(parseM3u(''), { extended: false, entries: [] });
  assert.equal(parseM3u('a.mp3\n#EXTM3U\nb.mp3').extended, false);
});

test('EXTINF forms: fractional duration, no title, empty title, no comma', () => {
  const list = parseM3u(
    '#EXTM3U\n#EXTINF:12.5,T\na\n#EXTINF:7\nb\n#EXTINF:0,\nc\n#EXTINF: 9 ,x\nd\n',
  );
  assert.deepEqual(
    list.entries.map((e) => [e.duration, e.title]),
    [
      [12.5, 'T'],
      [7, undefined],
      [0, undefined],
      [9, 'x'],
    ],
  );
});

test('malformed EXTINF and structure are rejected with line numbers', () => {
  const bad = [
    ['a.mp3\n#EXTINF:1,x\nb.mp3\n', 2],
    ['#EXTM3U\n#EXTINF:abc,x\na\n', 2],
    ['#EXTM3U\n#EXTINF:-2,x\na\n', 2],
    ['#EXTM3U\n#EXTINF:1,x\n#EXTINF:2,y\na\n', 2],
    ['#EXTM3U\n#EXTINF:1,x\n', 2],
    ['#EXTM3U\n#EXTINF:1 junk,x\na\n', 2],
    ['#EXTM3U\n#EXTINF:1abc,x\na\n', 2],
    ['#EXTM3U\na\u0001b\n', 2],
    ['#EXTM3U\na\u007fb\n', 2],
  ];
  for (const [text, line] of bad)
    assert.throws(
      () => parseM3u(text),
      (e) => e instanceof M3uError && e.line === line,
      JSON.stringify(text),
    );
});

test('location classification never resolves or fetches anything', () => {
  const cases = {
    'http://x/y': { kind: 'url', scheme: 'http' },
    'HTTPS://x': { kind: 'url', scheme: 'https' },
    'file:///etc/passwd': { kind: 'url', scheme: 'file' },
    'javascript:alert(1)': { kind: 'url', scheme: 'javascript' },
    'C:\\a.mp3': { kind: 'windows-path' },
    'c:/a.mp3': { kind: 'windows-path' },
    '\\\\server\\share\\a.mp3': { kind: 'unc-path' },
    '/etc/a.mp3': { kind: 'absolute-path' },
    '//host/a': { kind: 'absolute-path' },
    '../a.mp3': { kind: 'relative-path' },
    'a:b': { kind: 'windows-path' },
    'my song.mp3': { kind: 'relative-path' },
  };
  for (const [uri, expected] of Object.entries(cases))
    assert.deepEqual(classifyM3uLocation(uri), expected, uri);
});

test('allowedSchemes and allowedKinds enforce a safe subset', () => {
  const text = '#EXTM3U\nhttps://a/b\nfile:///x\nlocal.mp3\n';
  assert.equal(parseM3u(text).entries.length, 3);
  assert.throws(
    () => parseM3u(text, { allowedSchemes: ['https'] }),
    (e) => e.line === 3 && /file/.test(e.message),
  );
  assert.equal(parseM3u(text, { allowedSchemes: ['HTTPS', 'file'] }).entries.length, 3);
  assert.throws(
    () => parseM3u(text, { allowedKinds: ['url'] }),
    (e) => e.line === 4,
  );
  assert.equal(parseM3u('x.mp3\n', { allowedKinds: ['relative-path'] }).entries.length, 1);
  assert.throws(() => parseM3u('/abs\n', { allowedKinds: ['relative-path'] }), M3uError);
});

test('format round-trips and writes the header when metadata is present', () => {
  const list = parseM3u(SAMPLE);
  assert.deepEqual(parseM3u(formatM3u(list)), list);
  assert.equal(formatM3u({ entries: [{ uri: 'a.mp3' }] }), 'a.mp3\n');
  assert.equal(
    formatM3u({ entries: [{ uri: 'a.mp3', duration: 12.3456 }] }),
    '#EXTM3U\n#EXTINF:12.346,\na.mp3\n',
  );
  assert.equal(
    formatM3u({ entries: [{ uri: 'a', title: 'T' }] }, { lineEnding: '\r\n' }),
    '#EXTM3U\r\n#EXTINF:-1,T\r\na\r\n',
  );
  assert.equal(formatM3u({ extended: true, entries: [] }), '#EXTM3U\n');
  assert.equal(formatM3u({ entries: [] }), '');
});

test('format rejects injection and invalid values', () => {
  const bad = [
    { entries: [{ uri: 'a\nb' }] },
    { entries: [{ uri: 'a\r' }] },
    { entries: [{ uri: '' }] },
    { entries: [{ uri: ' a' }] },
    { entries: [{ uri: '#EXTINF:1,x' }] },
    { entries: [{ uri: 'a', title: 'x\n#EXTM3U' }] },
    { entries: [{ uri: 'a', duration: -2 }] },
    { entries: [{ uri: 'a', duration: NaN }] },
    { entries: [{ uri: 'a', duration: 1e12 }] },
    { entries: [{ uri: 'a', attributes: [{ name: 'a b', value: 'x' }] }] },
    { entries: [{ uri: 'a', attributes: [{ name: 'a', value: 'x"y' }] }] },
    { extended: false, entries: [{ uri: 'a', title: 'x' }] },
  ];
  for (const list of bad) assert.throws(() => formatM3u(list), RangeError, JSON.stringify(list));
  assert.throws(() => formatM3u({ entries: [] }, { lineEnding: '\r' }), RangeError);
});

test('limits and argument validation', () => {
  assert.throws(
    () => parseM3u('a\nb\n', { maxEntries: 1 }),
    (e) => e.line === 2,
  );
  assert.throws(() => parseM3u('abcdef', { maxLength: 3 }), M3uError);
  assert.throws(() => parseM3u('a', { maxEntries: 0 }), RangeError);
  assert.throws(() => parseM3u(null), TypeError);
});
