import { isMediaFlowSource, mediaFlowBaseUrl, mediaFlowRequest, mediaFlowResponse } from "./mediaflow-url";
import { readPlaybackPreferences, type PlaybackPreferences } from "./playback-preferences";

type ProxyPreferences = Pick<PlaybackPreferences, "mediaFlowMode" | "mediaFlowUrl" | "mediaFlowPassword">;
const cached = new Map<string, { url: string; expires: number }>();

/** Original stream URLs remain the selection/history identity. Only the
 * transport URL is replaced when the user has enabled the proxy. */
export async function resolveMediaFlowSource(source: string, signal: AbortSignal, preferences: ProxyPreferences = readPlaybackPreferences()): Promise<string> {
  signal.throwIfAborted();
  if (preferences.mediaFlowMode !== "in-house" && preferences.mediaFlowMode !== "custom") return source;
  if (isMediaFlowSource(source)) return source;
  const customBase = preferences.mediaFlowMode === "custom" ? mediaFlowBaseUrl(preferences.mediaFlowUrl) : undefined;
  if (preferences.mediaFlowMode === "custom" && !customBase) throw new Error("Enter a valid MediaFlow proxy URL in Playback settings.");
  const key = JSON.stringify([source, preferences.mediaFlowMode, preferences.mediaFlowUrl, preferences.mediaFlowPassword]);
  for (const [id, value] of cached) if (value.expires <= Date.now()) cached.delete(id);
  const existing = cached.get(key);
  if (existing) return existing.url;
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
  let url: string;
  try {
    if (preferences.mediaFlowMode === "in-house") {
      const response = await fetch("/api/playback/source", { method: "POST", credentials: "same-origin", signal: timeout,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: source, mediaFlow: "in-house" }) });
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (typeof result.url !== "string" || !isMediaFlowSource(result.url)) throw new Error();
      url = result.url;
    } else {
      const base = customBase!;
      const response = await fetch(new URL("generate_url", base), { method: "POST", credentials: "omit", redirect: "error", signal: timeout,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(mediaFlowRequest(base, source, preferences.mediaFlowPassword)) });
      if (!response.ok) throw new Error();
      url = mediaFlowResponse(base, await response.json());
    }
  } catch {
    signal.throwIfAborted();
    throw new Error("Could not connect to MediaFlow Proxy. Check Playback settings or turn off the proxy and try again.");
  }
  signal.throwIfAborted();
  cached.set(key, { url, expires: Date.now() + 6 * 60_000 });
  if (cached.size > 32) cached.delete(cached.keys().next().value!);
  return url;
}
