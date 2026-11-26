export function mediaFlowBaseUrl(value: string): URL | undefined {
  try {
    const url = new URL(value.trim());
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) return;
    url.pathname = url.pathname.replace(/\/+$/, "") + "/";
    return url;
  } catch { return; }
}

export function isMediaFlowSource(source: string): boolean {
  try {
    const url = new URL(source);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password
      && /\/proxy\/(?:stream(?:\/|$)|hls\/manifest\.m3u8$)/.test(url.pathname)
      && (/\/_token_[^/]+\/proxy\//.test(url.pathname) || url.searchParams.has("d"));
  }
  catch { return false; }
}

export function mediaFlowRequest(base: URL, source: string, password: string, hls = false) {
  const url = new URL(source);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.href.length > 8192) throw new Error("Choose an HTTP or HTTPS video stream.");
  const extension = /\.(mp4|m4v|mkv|webm|mov|avi|ts|mpeg|mpg|ogv)$/i.exec(url.pathname)?.[0];
  const playlist = hls || /\.m3u8$/i.test(url.pathname);
  return {
    mediaflow_proxy_url: base.href.replace(/\/$/, ""),
    endpoint: playlist ? "/proxy/hls/manifest.m3u8" : "/proxy/stream",
    destination_url: url.href,
    ...(playlist || !extension ? {} : { filename: `video${extension.toLowerCase()}` }),
    ...(password ? { api_password: password, expiration: 86400 } : {}),
  };
}

export function mediaFlowResponse(base: URL, result: unknown): string {
  const value = (result as { url?: unknown } | null)?.url;
  if (typeof value !== "string" || value.length > 32768) throw new Error("MediaFlow returned an invalid playback URL");
  const url = new URL(value);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || url.username || url.password || !isMediaFlowSource(url.href)) {
    throw new Error("MediaFlow returned an invalid playback URL");
  }
  return url.href;
}
