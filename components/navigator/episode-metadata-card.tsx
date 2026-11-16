"use client";

import { Star, Tv } from "lucide-react";
import { navigatorTitlePath } from "@/lib/navigator-title-path";
import { ResultCard, ResultMeta } from "./result-card";

export function EpisodeMetadataCard({ catalog }: {
  catalog: { seriesId?: string; seriesName?: string; episodeCount?: number; seasonCount?: number; seasonNumber?: number;
    poster?: string; year?: number; communityRating?: number; genres?: string[]; overview?: string };
}) {
  const href = catalog.seriesId ? navigatorTitlePath(catalog.seriesId, "series") : undefined;
  return <ResultCard
    title={catalog.seriesName || "Episode catalog"}
    icon={Tv}
    image={catalog.poster}
    href={href}
    metadata={<>
      <ResultMeta>Series</ResultMeta>
      {catalog.year != null && <ResultMeta>{catalog.year}</ResultMeta>}
      {catalog.communityRating != null && <ResultMeta><Star className="fill-yellow-400 text-yellow-400" />{catalog.communityRating.toFixed(1)}</ResultMeta>}
      {catalog.seasonNumber != null ? <ResultMeta>Season {catalog.seasonNumber}</ResultMeta> : catalog.seasonCount != null && <ResultMeta>{catalog.seasonCount} {catalog.seasonCount === 1 ? "season" : "seasons"}</ResultMeta>}
      {catalog.episodeCount != null && <ResultMeta>{catalog.episodeCount} {catalog.episodeCount === 1 ? "episode" : "episodes"}</ResultMeta>}
    </>}
    description={catalog.genres?.length ? catalog.genres.slice(0, 3).join(" · ") : undefined}
  />;
}
