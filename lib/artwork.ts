export type ArtworkKind = "poster" | "backdrop" | "logo" | "still";

const tmdbImageUrl = /^https:\/\/image\.tmdb\.org\/t\/p\/(?:w\d+|original)\/[\w.-]+\.(?:jpg|jpeg|png|webp|svg)$/i;
const cinemetaArtworkUrl = /^https:\/\/images\.metahub\.space\/(?:poster|background|logo)\/(?:small|medium|large|original)\/tt\d+\/img$/i;
const cinemetaStillUrl = /^https:\/\/episodes\.metahub\.space\/tt\d+\/\d+\/[1-9]\d*\/w\d+\.jpg$/i;

/** Only public provider URLs can be rendered or sent to the image service. */
export function publicArtworkUrl(source?: string): string | undefined {
  if (typeof source !== "string") return undefined;
  return tmdbImageUrl.test(source) || cinemetaArtworkUrl.test(source) || cinemetaStillUrl.test(source) ? source : undefined;
}

export function cinemetaTitleArtwork(id: string, kind: ArtworkKind): string | undefined {
  if (!/^tt\d+$/.test(id) || kind === "still") return undefined;
  const category = kind === "backdrop" ? "background" : kind;
  const size = kind === "poster" ? "small" : "medium";
  return `https://images.metahub.space/${category}/${size}/${id}/img`;
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
