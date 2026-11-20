// types/stremio.d.ts
// Stremio API type definitions

// ─── Authentication ──────────────────────────────────────────────

export interface StremioAuthResponse {
  result: StremioAuthResult;
}

export interface StremioAuthResult {
  authKey: string;
  user: StremioUser;
}

export interface StremioUser {
  _id: string;
  email: string;
  fbId?: string;
  avatar?: string;
  dateRegistered?: string;
  lastModified?: string;
  gdpr_consent?: {
    tos: boolean;
    privacy: boolean;
    marketing: boolean;
    from: string;
  };
  trakt?: {
    access_token?: string;
    created_at?: number;
  };
}

export interface StremioUserWithToken extends StremioUser {
  authKey: string;
}

// ─── Addon System ────────────────────────────────────────────────

export interface StremioAddonManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  logo?: string;
  background?: string;
  resources: (string | StremioAddonResource)[];
  types: string[];
  catalogs: StremioAddonCatalog[];
  idPrefixes?: string[];
  behaviorHints?: {
    adult?: boolean;
    p2p?: boolean;
    configurable?: boolean;
    configurationRequired?: boolean;
  };
}

export interface StremioAddonResource {
  name: string;
  types: string[];
  idPrefixes?: string[];
}

export interface StremioAddonCatalog {
  type: string;
  id: string;
  name?: string;
  extra?: StremioAddonCatalogExtra[];
}

export interface StremioAddonCatalogExtra {
  name: string;
  isRequired?: boolean;
  options?: string[];
  optionsLimit?: number;
}

export interface StremioAddon {
  transportUrl: string;
  transportName: string;
  manifest: StremioAddonManifest;
  flags: Record<string, boolean>;
}

export interface StremioAddonCollection {
  addons: StremioAddon[];
  lastModified: string;
}

// ─── Content / Meta ──────────────────────────────────────────────

export interface StremioMetaPreview {
  id: string;
  type: string;
  name: string;
  poster?: string;
  posterShape?: "square" | "poster" | "landscape";
  background?: string;
  logo?: string;
  description?: string;
  releaseInfo?: string;
  imdbRating?: string;
  genres?: string[];
  links?: StremioMetaLink[];
}

export interface StremioMeta extends StremioMetaPreview {
  cast?: string[];
  director?: string[];
  writer?: string[];
  runtime?: string;
  year?: number | string;
  country?: string;
  awards?: string;
  website?: string;
  trailers?: StremioMetaTrailer[];
  videos?: StremioVideo[];
  behaviorHints?: {
    defaultVideoId?: string;
    hasScheduledVideos?: boolean;
  };
}

export interface StremioMetaLink {
  name: string;
  category: string;
  url: string;
}

export interface StremioMetaTrailer {
  source: string;
  type: string;
}

export interface StremioVideo {
  id: string;
  title?: string;
  name?: string;
  released?: string;
  runtime?: string | number;
  thumbnail?: string;
  overview?: string;
  season?: number;
  episode?: number;
  resumePositionTicks?: number;
  progressPercent?: number;
  streams?: StremioStream[];
}

// ─── Streams ─────────────────────────────────────────────────────

export interface StremioStream {
  url?: string;
  ytId?: string;
  infoHash?: string;
  fileIdx?: number;
  externalUrl?: string;
  name?: string;
  title?: string;
  description?: string;
  behaviorHints?: {
    notWebReady?: boolean;
    bingeGroup?: string;
    countryWhitelist?: string[];
    countryBlacklist?: string[];
    proxyHeaders?: {
      request?: Record<string, string>;
      response?: Record<string, string>;
    };
    videoHash?: string;
    videoSize?: number;
    filename?: string;
  };
  subtitles?: StremioSubtitle[];
}

export interface StremioSubtitle {
  id: string;
  url: string;
  lang: string;
  label?: string;
}

// ─── Catalog Response ────────────────────────────────────────────

export interface StremioCatalogResponse {
  metas: StremioMetaPreview[];
  hasMore?: boolean;
  cacheMaxAge?: number;
}

export interface StremioMetaResponse {
  meta: StremioMeta;
  cacheMaxAge?: number;
}

export interface StremioStreamResponse {
  streams: StremioStream[];
  cacheMaxAge?: number;
}

export interface StremioSubtitleResponse {
  subtitles: StremioSubtitle[];
}

// ─── Internal App Types ──────────────────────────────────────────

export interface StremioAuthData {
  authKey: string;
  user: StremioUser;
  timestamp: number;
}

/** Unified media item shape used across UI components */
export interface MediaItem {
  imdbId?: string;
  tmdbId?: number;
  id: string;
  type: "movie" | "series" | "channel" | "tv";
  name: string;
  resumePositionTicks?: number;
  streamUrl?: string;
  mediaSourceId?: string;
  seriesId?: string;
  showName?: string;
  episodeId?: string;
  episodeTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  subtitleFilename?: string;
  subtitleVideoSize?: number;
  poster?: string;
  background?: string;
  logo?: string;
  description?: string;
  year?: number;
  releaseInfo?: string;
  imdbRating?: string;
  communityRating?: number;
  ratingSource?: string;
  voteCount?: number;
  runtime?: string;
  genres?: string[];
  cast?: string[];
  director?: string[];
  writer?: string[];
  progressPercent?: number;
  progressLabel?: string;
  /** Lightweight season summaries; episodes can be loaded independently. */
  seasons?: { number: number; name: string; episodeCount: number }[];
  videos?: StremioVideo[];
  links?: StremioMetaLink[];
  trailers?: StremioMetaTrailer[];
  /** The addon transport URL this item came from */
  addonTransportUrl?: string;
  addonName?: string;
  catalogName?: string;
  behaviorHints?: {
    defaultVideoId?: string;
    hasScheduledVideos?: boolean;
  };
}

/** Search result shape */
export interface SearchResult {
  department?: string;
  id: string;
  type: string;
  name: string;
  poster?: string;
  description?: string;
  releaseInfo?: string;
  imdbRating?: string;
  communityRating?: number;
  ratingSource?: string;
  year?: number;
  background?: string;
  addonName?: string;
  catalogId?: string;
  catalogName?: string;
}

export interface SearchCatalogSection {
  key: string;
  title: string;
  catalogId: string;
  catalogType: string;
  items: SearchResult[];
}
