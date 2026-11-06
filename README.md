# @lp-labs/m3u-playlist

Safe parser and formatter for plain and extended M3U/M3U8 text playlists: #EXTM3U, #EXTINF duration/attributes/title, location classification and scheme allow-lists. It only parses text; it never fetches, opens or resolves locations.

## Install

```sh
npm install @lp-labs/m3u-playlist
```

Node.js 18+; standalone ES2022 core with DOM-library types only. Zero runtime or peer dependencies. ESM and CommonJS builds with separate declarations. No filesystem, network, timer or environment access: every function works on in-memory bytes or strings you provide.

## Quickstart

```js
import { parseM3u } from '@lp-labs/m3u-playlist';
const playlist = parseM3u(
  '#EXTM3U\n#EXTINF:123,Artist - Song\nhttps://example.com/song.mp3\nlocal/other.flac\n',
);
console.log(playlist.extended, playlist.entries);
```

CommonJS consumers use `const api = require('@lp-labs/m3u-playlist')`. The same named API is available in both module formats. No default export.

## API, behavior and options

`parseM3u(text, options?)` returns `{ extended, entries }`. `extended` is true when the first non-blank line is exactly `#EXTM3U`. Each entry has `uri` (the trimmed location line, kept verbatim) and, when preceded by `#EXTINF:`, `duration` in seconds (`-1` = unknown; fractions allowed; other negatives rejected), `title` (text after the first comma that is not inside double quotes; absent when empty) and `attributes` (`name="value"` or `name=value` pairs between duration and comma, in order, such as `tvg-id` or `group-title`). `#EXTINF` requires the `#EXTM3U` header, must be followed by a location line, and may not be stacked. All other `#` lines (comments, `#EXTGRP`, HLS `#EXT-X-*`) are ignored, so this is not an HLS playlist model. Blank lines are skipped; BOM and CRLF/CR/LF are handled. Location lines containing control characters are rejected.

`classifyM3uLocation(uri)` returns `{ kind, scheme? }` with kind `'url'` (two or more character scheme, lower-cased), `'windows-path'` (`C:\\..` or any single-letter scheme), `'unc-path'`, `'absolute-path'` or `'relative-path'`. Nothing is resolved, normalized or looked up. Parse options: `allowedSchemes` (URL entries must use one of these schemes), `allowedKinds` (restrict classification kinds), `maxEntries` (100,000) and `maxLength` (16,777,216).

`formatM3u({ extended?, entries }, options?)` writes `#EXTM3U` when `extended` is true or any entry carries metadata (`extended: false` with metadata throws), then `#EXTINF:<duration>[ attrs],<title>` (duration defaults to -1, rounded to three decimals) and the location. Locations must be trimmed, single-line, free of control characters and may not start with `#`; titles and attribute values cannot contain line breaks (attribute values also not double quotes), which prevents playlist injection. `lineEnding` is `'\n'` (default) or `'\r\n'`.

All exports: `M3uAttribute`, `M3uEntry`, `M3uPlaylist`, `M3uLocationKind`, `M3uLocation`, `M3uParseOptions`, `M3uFormatOptions`, `M3uError`, `classifyM3uLocation`, `parseM3u`, `formatM3u`.

## Full TypeScript declarations

```ts
export interface M3uAttribute {
  readonly name: string;
  readonly value: string;
}
export interface M3uEntry {
  /** Location line exactly as written (trimmed). Never fetched or resolved by this library. */
  readonly uri: string;
  /** Seconds from #EXTINF; -1 means unknown. */
  readonly duration?: number;
  /** Text after the first top-level comma of #EXTINF. */
  readonly title?: string;
  /** key="value" pairs between the duration and the comma, in order. */
  readonly attributes?: readonly M3uAttribute[];
}
export interface M3uPlaylist {
  /** True when the playlist starts with #EXTM3U. */
  readonly extended: boolean;
  readonly entries: readonly M3uEntry[];
}
export type M3uLocationKind =
  'url' | 'absolute-path' | 'relative-path' | 'windows-path' | 'unc-path';
export interface M3uLocation {
  readonly kind: M3uLocationKind;
  /** Lower-case URL scheme when kind is "url". */
  readonly scheme?: string;
}
export interface M3uParseOptions {
  /** Maximum entries. Default 100,000. */
  maxEntries?: number;
  /** Maximum input length in UTF-16 units. Default 16,777,216. */
  maxLength?: number;
  /** When set, URL entries must use one of these (case-insensitive) schemes. */
  allowedSchemes?: readonly string[];
  /** When set, only these location kinds are accepted. */
  allowedKinds?: readonly M3uLocationKind[];
}
export interface M3uFormatOptions {
  /** Line terminator. Default "\n". */
  lineEnding?: '\n' | '\r\n';
}
export declare class M3uError extends Error {
  /** 1-based line number, or 0 when not line-specific. */
  readonly line: number;
  constructor(message: string, line: number);
}
/** Classifies a playlist location string without resolving it. */
export declare function classifyM3uLocation(uri: string): M3uLocation;
/** Parses an M3U/M3U8 text playlist (BOM and CRLF/CR/LF accepted). */
export declare function parseM3u(input: string, options?: M3uParseOptions): M3uPlaylist;
/** Formats a playlist; metadata forces the #EXTM3U header (an explicit extended:false with metadata is rejected). */
export declare function formatM3u(
  playlist: {
    readonly extended?: boolean;
    readonly entries: readonly M3uEntry[];
  },
  options?: M3uFormatOptions,
): string;
```

## Examples

### Accepting only https and relative entries

```js
import { M3uError, parseM3u } from '@lp-labs/m3u-playlist';
const text = '#EXTM3U\nhttps://example.com/a.mp3\nfile:///etc/passwd\n';
try {
  parseM3u(text, { allowedSchemes: ['https'] });
} catch (error) {
  console.log(error instanceof M3uError, error.line, error.message);
}
console.log(parseM3u(text, { allowedSchemes: ['https', 'file'] }).entries.length);
```

### Writing a playlist

```js
import { formatM3u } from '@lp-labs/m3u-playlist';
console.log(
  formatM3u({
    entries: [
      {
        uri: 'https://example.com/live',
        duration: -1,
        title: 'Live',
        attributes: [{ name: 'group-title', value: 'News, Live' }],
      },
      { uri: 'music/track.mp3', duration: 215.4, title: 'Track' },
    ],
  }),
);
```

## Customization

Pass `allowedSchemes`/`allowedKinds` to build an allow-list before you ever open a location; for example only `https` URLs and relative paths. Resolve relative paths against your own base and reject `..` segments yourself. Use `maxEntries`/`maxLength` for untrusted playlists. Decode bytes to text first (M3U is often Latin-1 and M3U8 is UTF-8).

## Errors

Invalid playlists throw `M3uError` with a 1-based `line` (0 for whole-input limits). Formatter validation and option errors throw `RangeError`; wrong types throw `TypeError`. Parsing is all-or-nothing.

## Performance

One pass over the lines; per-line work is linear and the attribute scanner never backtracks. Memory is proportional to the entries returned.

## Scope and non-goals

No network, filesystem or URL resolution; no HLS/DASH manifest semantics (segments, variants, keys), no playlist merging, no charset detection, no duration validation against media. Unrecognized `#` lines are discarded, not preserved. Classification is syntactic and is not a security verdict: validate or sandbox before opening anything a playlist names.

## Development

```sh
npm ci --offline
npm run typecheck
npm test
npm run format:check
```

TypeScript ^5.9.3 and Prettier ^3.6.2 are development-only. Build emits dist/esm and dist/cjs. Tests use Node's test runner; consumer.mts and consumer.cts exercise bare package imports including negative type assertions.

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
