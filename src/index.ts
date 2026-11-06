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

export class M3uError extends Error {
  /** 1-based line number, or 0 when not line-specific. */
  readonly line: number;
  constructor(message: string, line: number) {
    super(line > 0 ? `line ${line}: ${message}` : message);
    this.name = 'M3uError';
    this.line = line;
  }
}

const CONTROL = /[\x00-\x08\x0a-\x1f\x7f]/;
const EXTINF = /^#EXTINF:[ \t]*(-?\d+(?:\.\d+)?)(.*)$/;

function posInt(value: number | undefined, fallback: number, name: string): number {
  const v = value ?? fallback;
  if (!Number.isSafeInteger(v) || v < 1) throw new RangeError(`${name} must be a positive integer`);
  return v;
}

/** Classifies a playlist location string without resolving it. */
export function classifyM3uLocation(uri: string): M3uLocation {
  if (uri.startsWith('\\\\')) return { kind: 'unc-path' };
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(uri);
  if (m !== null) {
    if (m[1]!.length === 1) return { kind: 'windows-path' };
    return { kind: 'url', scheme: m[1]!.toLowerCase() };
  }
  if (uri.startsWith('/')) return { kind: 'absolute-path' };
  return { kind: 'relative-path' };
}

function splitExtinf(
  rest: string,
  line: number,
): { attributes: M3uAttribute[]; title: string | undefined } {
  let quoted = false;
  let comma = -1;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) {
      comma = i;
      break;
    }
  }
  const head = comma < 0 ? rest : rest.slice(0, comma);
  const title = comma < 0 ? undefined : rest.slice(comma + 1);
  const attributes: M3uAttribute[] = [];
  const pattern = /([A-Za-z0-9_-]+)=(?:"([^"]*)"|([^\s",]*))/y;
  let at = 0;
  while (at < head.length) {
    const ws = /^[ \t]*/.exec(head.slice(at))![0].length;
    at += ws;
    if (at >= head.length) break;
    pattern.lastIndex = at;
    const m = pattern.exec(head);
    if (m === null || (at > 0 && ws === 0)) throw new M3uError('invalid #EXTINF attributes', line);
    attributes.push({ name: m[1]!, value: m[2] ?? m[3] ?? '' });
    at = pattern.lastIndex;
  }
  return { attributes, title: title === undefined || title === '' ? undefined : title };
}

/** Parses an M3U/M3U8 text playlist (BOM and CRLF/CR/LF accepted). */
export function parseM3u(input: string, options: M3uParseOptions = {}): M3uPlaylist {
  if (typeof input !== 'string') throw new TypeError('input must be a string');
  const maxEntries = posInt(options.maxEntries, 100_000, 'maxEntries');
  const maxLength = posInt(options.maxLength, 16_777_216, 'maxLength');
  if (input.length > maxLength) throw new M3uError('input exceeds maxLength', 0);
  const schemes = options.allowedSchemes?.map((s) => s.toLowerCase());
  const lines = (input.charCodeAt(0) === 0xfeff ? input.slice(1) : input).split(/\r\n|\r|\n/);
  let extended = false;
  let pending:
    | { duration: number; title: string | undefined; attributes: M3uAttribute[]; line: number }
    | undefined;
  let seenContent = false;
  const entries: M3uEntry[] = [];
  lines.forEach((raw, n) => {
    const line = raw.trim();
    if (line === '') return;
    const number = n + 1;
    if (!seenContent) {
      seenContent = true;
      if (line === '#EXTM3U') {
        extended = true;
        return;
      }
    }
    if (line.startsWith('#')) {
      if (line.startsWith('#EXTINF:')) {
        if (!extended) throw new M3uError('#EXTINF requires a #EXTM3U first line', number);
        if (pending !== undefined)
          throw new M3uError('#EXTINF without a following location', pending.line);
        const m = EXTINF.exec(line);
        if (m === null) throw new M3uError('invalid #EXTINF duration', number);
        const duration = Number(m[1]);
        if (duration < -1 || !Number.isFinite(duration))
          throw new M3uError('duration must be -1 or non-negative', number);
        const { attributes, title } = splitExtinf(m[2]!, number);
        pending = { duration, title, attributes, line: number };
      }
      return;
    }
    if (CONTROL.test(line)) throw new M3uError('location contains control characters', number);
    if (entries.length >= maxEntries) throw new M3uError('too many entries', number);
    const location = classifyM3uLocation(line);
    if (options.allowedKinds !== undefined && !options.allowedKinds.includes(location.kind)) {
      throw new M3uError(`location kind ${location.kind} is not allowed`, number);
    }
    if (location.kind === 'url' && schemes !== undefined && !schemes.includes(location.scheme!)) {
      throw new M3uError(`URL scheme ${location.scheme} is not allowed`, number);
    }
    if (pending === undefined) entries.push({ uri: line });
    else {
      const base = { uri: line, duration: pending.duration };
      const withTitle = pending.title === undefined ? base : { ...base, title: pending.title };
      entries.push(
        pending.attributes.length > 0
          ? { ...withTitle, attributes: pending.attributes }
          : withTitle,
      );
      pending = undefined;
    }
  });
  if (pending !== undefined)
    throw new M3uError('#EXTINF without a following location', pending.line);
  return { extended, entries };
}

/** Formats a playlist; metadata forces the #EXTM3U header (an explicit extended:false with metadata is rejected). */
export function formatM3u(
  playlist: { readonly extended?: boolean; readonly entries: readonly M3uEntry[] },
  options: M3uFormatOptions = {},
): string {
  const eol = options.lineEnding ?? '\n';
  if (eol !== '\n' && eol !== '\r\n') throw new RangeError('lineEnding must be "\\n" or "\\r\\n"');
  const hasMeta = playlist.entries.some(
    (e) => e.duration !== undefined || e.title !== undefined || (e.attributes?.length ?? 0) > 0,
  );
  if (playlist.extended === false && hasMeta)
    throw new RangeError('extended:false cannot carry #EXTINF metadata');
  const extended = playlist.extended ?? hasMeta;
  const out: string[] = extended ? ['#EXTM3U'] : [];
  playlist.entries.forEach((entry, n) => {
    const uri = entry.uri;
    if (typeof uri !== 'string' || uri.trim() === '' || uri !== uri.trim())
      throw new RangeError(`entry ${n}: uri must be a non-blank trimmed string`);
    if (CONTROL.test(uri)) throw new RangeError(`entry ${n}: uri contains control characters`);
    if (uri.startsWith('#')) throw new RangeError(`entry ${n}: uri may not start with "#"`);
    const meta =
      entry.duration !== undefined ||
      entry.title !== undefined ||
      (entry.attributes?.length ?? 0) > 0;
    if (meta) {
      const duration = entry.duration ?? -1;
      if (!Number.isFinite(duration) || duration < -1 || duration >= 1e12)
        throw new RangeError(`entry ${n}: duration must be -1 or 0..1e12`);
      let attrs = '';
      for (const a of entry.attributes ?? []) {
        if (!/^[A-Za-z0-9_-]+$/.test(a.name) || /["\r\n]/.test(a.value))
          throw new RangeError(`entry ${n}: invalid attribute ${a.name}`);
        attrs += ` ${a.name}="${a.value}"`;
      }
      const title = entry.title ?? '';
      if (/[\r\n]/.test(title))
        throw new RangeError(`entry ${n}: title may not contain line breaks`);
      out.push(`#EXTINF:${Number(duration.toFixed(3))}${attrs},${title}`);
    }
    out.push(uri);
  });
  return out.length === 0 ? '' : out.join(eol) + eol;
}
