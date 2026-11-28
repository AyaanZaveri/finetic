import { validEpisode, type StreamChoice, type StreamSnapshot, type StreamTarget } from './stream-selection';
import { validMediaId } from './home-catalog';
export type { StreamChoice, StreamSnapshot, StreamTarget } from './stream-selection';

const STREMIO_API = 'https://api.strem.io/api';
const ADDON_CONCURRENCY = 6;

export type StreamSessionStore = {
  read(): Promise<string | null>;
  write(key: string): Promise<void>;
  clear(): Promise<void>;
};
export function streamTargetId(target: StreamTarget) {
  if (!validMediaId(target.id)) throw new Error('Invalid title.');
  if (target.type !== 'series') return target.id;
  if (!validEpisode(target.season, target.episode)) {
    throw new Error('Select a series episode first.');
  }
  return `${target.id}:${target.season}:${target.episode}`;
}
function abortError() { return new DOMException('Request cancelled.', 'AbortError'); }
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value : undefined;
export const emptyStreamSnapshot = (): StreamSnapshot => ({ streams: [], addons: [], pending: 0, total: 0, complete: false, signedIn: null });

async function json(url: string, init: RequestInit, parent: AbortSignal | undefined, timeoutMs: number, source: string): Promise<{ response: Response; body: Record<string, unknown> }> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parent?.aborted) controller.abort();
  else parent?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    if (parent?.aborted) throw abortError();
    const response = await fetch(url, { ...init, credentials: 'omit', signal: controller.signal, headers: { Accept: 'application/json', ...init.headers } });
    const body = record(await response.json().catch(() => null));
    if (controller.signal.aborted) throw abortError();
    return { response, body };
  } catch {
    if (parent?.aborted) throw abortError();
    if (controller.signal.aborted) throw new Error('Request timed out. Try again.');
    throw new Error(`Could not connect to ${source}. Check your connection and try again.`);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', abort);
  }
}

function stremioRequest(method: 'login' | 'addonCollectionGet', body: Record<string, unknown>, signal?: AbortSignal) {
  // Never follow redirects with Stremio credentials or attach cookies.
  return json(`${STREMIO_API}/${method}`, {
    method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, signal, 12_000, 'Stremio');
}

function supportsStream(manifest: Record<string, unknown>, type: StreamTarget['type'], id: string) {
  return Array.isArray(manifest.resources) && manifest.resources.some(resource => {
    const descriptor = record(resource);
    if (resource !== 'stream' && descriptor.name !== 'stream') return false;
    const types = descriptor.types ?? manifest.types;
    const prefixes = descriptor.idPrefixes ?? manifest.idPrefixes;
    return (!Array.isArray(types) || types.includes(type)) &&
      (!Array.isArray(prefixes) || prefixes.some(prefix => typeof prefix === 'string' && id.startsWith(prefix)));
  });
}

function streamAddonUrl(transport: string, type: StreamTarget['type'], id: string) {
  try {
    const url = new URL(transport.replace(/^stremio:\/\//i, 'https://'));
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !url.pathname.endsWith('/manifest.json')) return null;
    url.pathname = url.pathname.replace(/\/manifest\.json$/, `/stream/${type}/${encodeURIComponent(id)}.json`);
    url.hash = '';
    return url.toString();
  } catch { return null; }
}

function headers(value: unknown) {
  return Object.fromEntries(Object.entries(record(value)).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function parseStream(value: unknown, addon: StreamSnapshot['addons'][number], index: number): StreamChoice | null {
  const raw = record(value);
  if (!Object.keys(raw).length) return null;
  const hints = record(raw.behaviorHints);
  const proxy = record(hints.proxyHeaders);
  const stream: StreamChoice = {
    addonId: addon.id, addonName: addon.name, addonLogo: addon.logo, addonIndex: index,
    url: text(raw.url), externalUrl: text(raw.externalUrl), ytId: text(raw.ytId), infoHash: text(raw.infoHash),
    fileIdx: typeof raw.fileIdx === 'number' && Number.isSafeInteger(raw.fileIdx) && raw.fileIdx >= 0 ? raw.fileIdx : undefined,
    name: text(raw.name), title: text(raw.title), description: text(raw.description),
    behaviorHints: {
      filename: text(hints.filename), videoHash: text(hints.videoHash),
      videoSize: typeof hints.videoSize === 'number' && Number.isFinite(hints.videoSize) && hints.videoSize >= 0 ? hints.videoSize : undefined,
      notWebReady: hints.notWebReady === true,
      proxyHeaders: { request: headers(proxy.request), response: headers(proxy.response) },
    },
    subtitles: Array.isArray(raw.subtitles) ? raw.subtitles.flatMap(value => {
      const sub = record(value);
      const id = text(sub.id), url = text(sub.url), lang = text(sub.lang);
      return id && url && lang ? [{ id, url, lang, label: text(sub.label) }] : [];
    }) : undefined,
  };
  // Provider notices are useful context even without a playable URL.
  return stream.url || stream.externalUrl || stream.infoHash || stream.ytId || stream.name || stream.title || stream.description ? stream : null;
}

export function createStreamClient(session: StreamSessionStore) {
  let writes = Promise.resolve();
  // An expired response from an old session must not erase a newer sign-in.
  function mutateSession(action: () => Promise<void>) {
    const operation = writes.then(action);
    writes = operation.catch(() => {});
    return operation;
  }

  async function signIn(email: string, password: string, signal?: AbortSignal) {
    const { response, body } = await stremioRequest('login', { type: 'Login', email, password, facebook: false }, signal);
    const authKey = text(record(body.result).authKey);
    if (response.status === 429) throw new Error('Too many sign-in attempts. Wait before trying again.');
    if (response.status === 401 || (response.ok && body.error)) throw new Error('Stremio could not sign you in. Check your email and password.');
    if (!response.ok || !authKey) throw new Error('Could not sign in to Stremio. Try again.');
    await mutateSession(async () => {
      if (signal?.aborted) throw abortError();
      await session.write(authKey);
    });
  }

  async function signOut(signal?: AbortSignal) {
    await mutateSession(async () => {
      if (signal?.aborted) throw abortError();
      await session.clear();
    });
  }

  async function loadStreamSnapshot(target: StreamTarget, signal?: AbortSignal, onSnapshot?: (snapshot: StreamSnapshot) => void): Promise<StreamSnapshot> {
    const base = emptyStreamSnapshot();
    const signedOut = { ...base, complete: true, signedIn: false };
    let snapshot = base;
    const emit = (value: StreamSnapshot) => {
      if (signal?.aborted) throw abortError();
      snapshot = value;
      onSnapshot?.(value);
      return value;
    };
    try {
      const id = streamTargetId(target);
      if (signal?.aborted) throw abortError();
      await writes;
      const authKey = await session.read();
      if (!authKey) return emit(signedOut);
      snapshot = { ...base, signedIn: true };
      const { response, body } = await stremioRequest('addonCollectionGet', { type: 'AddonCollectionGet', authKey, update: false }, signal);
      if (response.status === 401 || record(body.error).code === 1) {
        await mutateSession(async () => {
          if (signal?.aborted) throw abortError();
          if (await session.read() === authKey) await session.clear();
        });
        return emit(signedOut);
      }
      const installed = record(body.result).addons;
      if (!response.ok || !Array.isArray(installed)) throw new Error('Could not load your add-ons from Stremio. Try again.');
      const seen = new Set<string>();
      const applicable = installed.flatMap(value => {
        const addon = record(value);
        const manifest = record(addon.manifest);
        const transport = text(addon.transportUrl);
        if (!transport || !supportsStream(manifest, target.type, id)) return [];
        const url = streamAddonUrl(transport, target.type, id);
        if (!url || seen.has(url)) return [];
        seen.add(url);
        // An installed URL can contain provider configuration or credentials.
        // Keep it outside the snapshot, display text, and row identifiers.
        return [{ url, addon: { id: `addon-${seen.size}`, name: text(manifest.name) || 'Add-on', logo: text(manifest.logo) } }];
      });
      const addons = applicable.map(item => item.addon);
      emit({ ...snapshot, addons, total: addons.length, pending: addons.length, complete: addons.length === 0 });

      const results: StreamChoice[][] = addons.map(() => []);
      let nextIndex = 0;
      async function worker() {
        while (!signal?.aborted && nextIndex < applicable.length) {
          const index = nextIndex++;
          const { url, addon } = applicable[index];
          let error: string | undefined;
          try {
            const { response: result, body: payload } = await json(url, {}, signal, 30_000, 'the add-on');
            if (!result.ok || !Array.isArray(payload.streams)) throw new Error('Invalid add-on response.');
            results[index] = payload.streams.flatMap(raw => {
              const stream = parseStream(raw, addon, index);
              return stream ? [stream] : [];
            });
          } catch {
            if (signal?.aborted) return;
            error = addons.length === 1 ? 'The add-on could not load streams.' : 'Some add-ons could not load streams.';
          }
          const pending = snapshot.pending - 1;
          emit({ ...snapshot, streams: results.flat(), pending, complete: pending === 0, error: snapshot.error ?? error });
        }
      }
      await Promise.all(Array.from({ length: Math.min(ADDON_CONCURRENCY, addons.length) }, worker));
      if (signal?.aborted) throw abortError();
      return snapshot;
    } catch (error) {
      if (signal?.aborted) throw abortError();
      return emit({ ...snapshot, pending: 0, complete: true, error: error instanceof Error ? error.message : 'Could not load streams.' });
    }
  }

  return { signIn, signOut, loadStreamSnapshot };
}
