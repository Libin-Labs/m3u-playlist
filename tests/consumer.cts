import {
  M3uError,
  classifyM3uLocation,
  formatM3u,
  parseM3u,
  type M3uEntry,
  type M3uLocation,
  type M3uPlaylist,
} from '@lp-labs/m3u-playlist';
const list: M3uPlaylist = parseM3u('#EXTM3U\n#EXTINF:1,T\na.mp3\n', {
  allowedSchemes: ['https'],
  allowedKinds: ['url', 'relative-path'],
});
const entry: M3uEntry = list.entries[0]!;
const where: M3uLocation = classifyM3uLocation(entry.uri);
const text: string = formatM3u({ entries: [entry] }, { lineEnding: '\r\n' });
const error: M3uError = new M3uError('x', 1);
void [where.kind, text, error.line];
// @ts-expect-error unknown location kind
parseM3u('a', { allowedKinds: ['ftp'] });
// @ts-expect-error entries are read-only
entry.uri = 'b';
