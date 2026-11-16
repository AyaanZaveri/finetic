export type ArtworkKind = "poster" | "backdrop" | "logo" | "still";

/** Only public TMDB images can be sent to the external image service. */
export function publicArtworkUrl(source?: string): string | undefined {
  return source && /^https:\/\/image\.tmdb\.org\/t\/p\/(?:w\d+|original)\/[\w.-]+\.(?:jpg|jpeg|png|webp|svg)$/i.test(source) ? source : undefined;
}

export function backdropVariantUrl(source: string | undefined, width: 300 | 780 | 1280): string | undefined {
  return publicArtworkUrl(source) ? source!.replace(/\/t\/p\/[^/]+\//, `/t/p/w${width}/`) : source;
}

/** Canvas reads go directly to the image service, never through the app server.
 * Keep full resolution for logo geometry and masks. */
export function artworkSampleUrl(source: string): string {
  if (!publicArtworkUrl(source)) return source;
  return `https://wsrv.nl/?${new URLSearchParams({ url: source, output: "png" })}`;
}

/** Artwork is resolved on the server and carried with each media record. */
export function mediaArtwork(item: { poster?: string; background?: string; logo?: string }) {
  return { poster: publicArtworkUrl(item.poster), background: publicArtworkUrl(item.background), logo: publicArtworkUrl(item.logo) };
}

export function episodeThumbnailUrl(thumbnail: string | undefined, _showId: string, _season: number, _episode: number): string | undefined {
  return publicArtworkUrl(thumbnail);
}

export function episodeHeroStillUrl(source: string | undefined): string | undefined {
  return publicArtworkUrl(source) ? source!.replace(/\/t\/p\/[^/]+\//, "/t/p/w1280/") : source;
}
