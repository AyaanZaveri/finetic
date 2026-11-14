import type { WebGpuSubtitleBlock } from "./webgpu-module";

export interface MatroskaSubtitleTrack {
    number: number; codec: string; language: string; label: string;
    forced: boolean; hearingImpaired: boolean;
    compression?: { algorithm: number; scope: number; prefix: Uint8Array };
}
type Element = { id: number; start: number; end: number };
const TRACKS = 0x1654ae6b;
const MAX_METADATA = 2 * 1024 * 1024;
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes).replace(/\0+$/, "");
function vint(bytes: Uint8Array, offset: number, id = false) {
    const first = bytes[offset];
    if (!first) throw new Error("Invalid Matroska integer");
    let length = 1, mask = 128;
    while (!(first & mask)) { length++; mask /= 2; }
    if (length > (id ? 4 : 8) || offset + length > bytes.length) throw new Error("Truncated Matroska integer");
    let value = id ? first : first & (mask - 1), unknown = !id && value === mask - 1;
    for (let i = 1; i < length; i++) { value = value * 256 + bytes[offset + i]; unknown &&= bytes[offset + i] === 255; }
    if (!unknown && !Number.isSafeInteger(value)) throw new Error("Invalid Matroska size");
    return { value: unknown ? Infinity : value, length };
}
function element(bytes: Uint8Array, offset: number): Element {
    const id = vint(bytes, offset, true), size = vint(bytes, offset + id.length);
    const start = offset + id.length + size.length;
    return { id: id.value, start, end: start + size.value };
}
function children(bytes: Uint8Array, start: number, end: number): Element[] {
    const items: Element[] = [];
    for (let offset = start; offset < Math.min(end, bytes.length) && items.length < 4096;) {
        const item = element(bytes, offset);
        if (item.end > bytes.length || item.end > end) break;
        items.push(item); offset = item.end;
    }
    return items;
}
function integer(bytes: Uint8Array, item?: Element, defaultValue = 0): number {
    if (!item) return defaultValue;
    if (item.end - item.start > 8) return NaN;
    let value = 0;
    for (let i = item.start; i < item.end; i++) value = value * 256 + bytes[i];
    return Number.isSafeInteger(value) ? value : NaN;
}
function fields(bytes: Uint8Array, item: Element) {
    const items = children(bytes, item.start, item.end);
    const find = (id: number) => items.find(field => field.id === id);
    return { find, number: (id: number, fallback = 0) => integer(bytes, find(id), fallback),
        text: (id: number) => { const field = find(id); return field ? text(bytes.subarray(field.start, field.end)) : ""; } };
}

/** Track numbers are the Matroska numbers in the engine's subtitle-block events. */
export function parseMatroskaSubtitleTracks(bytes: Uint8Array): MatroskaSubtitleTrack[] {
    const root = element(bytes, 0);
    let tracks: Element | undefined = root.id === TRACKS ? root : undefined;
    if (!tracks) {
        if (root.id !== 0x1a45dfa3 || root.end >= bytes.length) return [];
        const segment = element(bytes, root.end);
        if (segment.id !== 0x18538067) return [];
        tracks = children(bytes, segment.start, segment.end).find(item => item.id === TRACKS);
    }
    if (!tracks || tracks.end > bytes.length) return [];
    return children(bytes, tracks.start, tracks.end).filter(item => item.id === 0xae).flatMap(entry => {
        const track = fields(bytes, entry);
        if (track.number(0x83) !== 17) return [];
        const number = track.number(0xd7), codec = track.text(0x86);
        if (!Number.isSafeInteger(number) || number <= 0 || !/^(S_TEXT\/(UTF8|ASCII|WEBVTT|ASS|SSA)|S_ASS|S_SSA|D_WEBVTT\/(SUBTITLES|CAPTIONS))$/.test(codec)) return [];
        let compression: MatroskaSubtitleTrack["compression"];
        const encodings = track.find(0x6d80);
        if (encodings) {
            const entries = children(bytes, encodings.start, encodings.end).filter(item => item.id === 0x6240);
            if (entries.length !== 1) return [];
            const encoding = fields(bytes, entries[0]);
            if (encoding.number(0x5033) !== 0) return [];
            const compressed = encoding.find(0x5034);
            if (!compressed) return [];
            const values = fields(bytes, compressed), algorithm = values.number(0x4254);
            if (algorithm !== 0 && algorithm !== 3) return [];
            const prefix = values.find(0x4255);
            compression = { algorithm, scope: encoding.number(0x5032, 1), prefix: prefix ? bytes.slice(prefix.start, prefix.end) : new Uint8Array() };
        }
        const language = track.text(0x22b59d) || track.text(0x22b59c) || "und";
        return [{ number, codec, language, label: track.text(0x536e) || language,
            forced: track.number(0x55aa) === 1, hearingImpaired: track.number(0x55ab) === 1, compression }];
    });
}

/** Read only bounded header/Tracks ranges, never scan or download video clusters. */
export async function readMatroskaSubtitleTracks(url: string, signal: AbortSignal): Promise<MatroskaSubtitleTrack[]> {
    let budget = MAX_METADATA;
    const range = async (start: number, size = 256 * 1024): Promise<Uint8Array> => {
        const length = Math.min(size, budget);
        if (length <= 0) throw new Error("Subtitle metadata limit");
        const response = await fetch(url, { signal, headers: { Range: `bytes=${start}-${start + length - 1}` }, credentials: "omit" });
        if (!response.ok || (start > 0 && response.status !== 206) || !response.body) {
            await response.body?.cancel(); throw new Error("Subtitle range unavailable");
        }
        const visibleRange = response.headers.get("Content-Range");
        if (visibleRange && !visibleRange.startsWith(`bytes ${start}-`)) {
            await response.body.cancel(); throw new Error("Invalid subtitle range");
        }
        const reader = response.body.getReader(), chunks: Uint8Array[] = [];
        let received = 0;
        try {
            while (received < length) {
                const result = await reader.read();
                if (result.done) break;
                const chunk = result.value.subarray(0, length - received);
                chunks.push(chunk); received += chunk.length;
            }
        } finally { await reader.cancel(); }
        budget -= received;
        const bytes = new Uint8Array(received);
        let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        return bytes;
    };
    const head = await range(0);
    const root = element(head, 0);
    if (root.id !== 0x1a45dfa3) return [];
    const segment = element(head, root.end);
    if (segment.id !== 0x18538067) return [];
    for (let offset = segment.start; offset < head.length;) {
        const item = element(head, offset);
        if (item.id === TRACKS) {
            const bytes = item.end <= head.length ? head.subarray(offset, item.end)
                : await range(offset, Math.min(item.end - offset, budget));
            return parseMatroskaSubtitleTracks(bytes);
        }
        if (item.id === 0x114d9b74 && item.end <= head.length) {
            for (const seek of children(head, item.start, item.end).filter(child => child.id === 0x4dbb)) {
                const entry = fields(head, seek);
                if (entry.number(0x53ab) !== TRACKS) continue;
                const position = segment.start + entry.number(0x53ac);
                if (!Number.isSafeInteger(position) || position < segment.start) continue;
                return parseMatroskaSubtitleTracks(await range(position));
            }
        }
        if (!Number.isFinite(item.end) || item.end > head.length) break;
        offset = item.end;
    }
    return [];
}

export async function matroskaSubtitleText(track: MatroskaSubtitleTrack, block: WebGpuSubtitleBlock): Promise<string> {
    let bytes = block.data;
    if (bytes.byteLength > 64 * 1024) return "";
    if (track.compression && (track.compression.scope & 1)) {
        const { algorithm, prefix } = track.compression;
        if (algorithm === 3) {
            const joined = new Uint8Array(prefix.length + bytes.length); joined.set(prefix); joined.set(bytes, prefix.length); bytes = joined;
        } else {
            const body = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream("deflate"));
            const reader = body.getReader(), chunks: Uint8Array[] = [];
            let length = 0;
            try {
                while (true) {
                    const result = await reader.read(); if (result.done) break;
                    length += result.value.length; if (length > 64 * 1024) return "";
                    chunks.push(result.value);
                }
            } finally { await reader.cancel(); }
            bytes = new Uint8Array(length); let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        }
    }
    let value = text(bytes);
    if (/ASS|SSA/.test(track.codec)) {
        // Matroska ASS packets omit the times and keep eight fields before Text.
        let start = 0;
        for (let i = 0; i < 8; i++) { start = value.indexOf(",", start); if (start < 0) return ""; start++; }
        value = value.slice(start).replace(/\{[^}]*\}/g, "").replace(/\\[Nn]/g, "\n").replace(/\\h/g, " ");
    }
    if (track.codec.startsWith("D_WEBVTT/")) value = value.split("\n").slice(2).join("\n");
    // Render as React text, never as file-provided HTML.
    return value.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/?(?:b|i|u|s|font)(?:\s[^>]*)?>/gi, "")
        .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_match, name: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[name] || "")
        .trim().slice(0, 16384);
}
