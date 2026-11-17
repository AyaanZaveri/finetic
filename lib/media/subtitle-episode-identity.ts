interface EpisodeSubtitleTrack { filename?: string; src: string }

const normalize = (value: string) => value.toLowerCase().normalize("NFKD")
  .replace(/\p{M}/gu, "").replace(/['’‘`]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Subtitle catalogs can count specials differently from the canonical video catalog. */
export async function matchEpisodeSubtitleTracks<T extends EpisodeSubtitleTrack>(
  sourceId: string,
  episodeTitle: string | undefined,
  tracks: T[],
  loadNearby: (_sourceId: string) => Promise<T[]>,
  signal?: AbortSignal,
): Promise<T[]> {
  const episode = /^(tt\d+|tmdb:\d+):(\d+):(\d+)$/.exec(sourceId);
  const title = normalize(episodeTitle || "");
  if (!episode || !title || /^(?:episode|ep)\s*\d+$|^s\d+\s*e\d+$|^\d+x\d+$/.test(title) || !tracks.some(track => track.filename)) return tracks;
  const matches = (track: T) => !!track.filename && ` ${normalize(track.filename)} `.includes(` ${title} `);
  let matching = tracks.filter(matches);
  if (!matching.length) {
    const number = Number(episode[3]);
    const nearby = await Promise.all([number - 1, number + 1].filter(value => value > 0).map(async value => {
      try { return await loadNearby(`${episode[1]}:${episode[2]}:${value}`); }
      catch { signal?.throwIfAborted(); return []; }
    }));
    matching = nearby.flat().filter(matches);
  }
  signal?.throwIfAborted();
  // A numbered release filename alone cannot establish identity. Prefer only
  // the title-backed matches when available, without changing the video ID.
  return matching.length ? matching.filter((track, index, all) => all.findIndex(other => other.src === track.src) === index) : tracks;
}
