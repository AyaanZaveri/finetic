import titleStyles from "@/components/media-page/title-detail.module.css";
import { PosterImage } from "@/components/media-page/poster-image";
import backdropStyles from "@/components/media-page/backdrop-transition.module.css";
import { BackdropTransition } from "@/components/media-page/backdrop-transition";
import { VibrantAuroraBackground } from "@/components/vibrant-aurora-background";
import { HeroWordmark } from "@/components/hero-wordmark";
import { IntentLink } from "@/components/intent-link";
import { BackdropImage } from "@/components/media-page/backdrop-image";
import { buildSeriesPath } from "@/lib/series-route";
import type { MediaItem } from "@/types/stremio";
import type { ReactNode } from "react";

export function SeriesDetailsFrame({ show, children, cast, recommendations }: {
  show: MediaItem;
  children: ReactNode;
  cast?: ReactNode;
  recommendations?: ReactNode;
}) {
  return (
      <div className={`${backdropStyles.page} ${titleStyles.page} relative min-h-screen overflow-hidden pb-8`}>
        <VibrantAuroraBackground
          backdropUrl={show.background}
          posterUrl={show.poster}
          opacity={0.2}
        />

        <div className="relative">
          <div className={`${backdropStyles.hero} ${titleStyles.hero} relative overflow-hidden`} data-artwork={show.background ? "backdrop" : show.poster ? "poster" : "none"}>
            <BackdropImage
              movie={show}
              backdropImage={show.background || ""}
              className={`${backdropStyles.artwork} w-full h-full object-cover`}
              width={1920}
              height={1080}
            />
            {!show.background && show.poster && (
              <div className={titleStyles.posterFallback}>
                <PosterImage movie={show} posterImage={show.poster} className="w-full h-full object-cover" />
              </div>
            )}
            {show.logo && (
              <div className={`${backdropStyles.wordmarkRegion} ${titleStyles.wordmark}`}>
                <IntentLink
                  href={buildSeriesPath(show.id)}
                  draggable={false}
                  aria-label={`Go to ${show.name} series page`}
                  className="pointer-events-auto block w-[min(15rem,65%)] [--hero-wordmark-height:4rem] md:w-[min(48rem,75%)] md:[--hero-wordmark-height:7rem] motion-safe:transition-[transform] motion-safe:duration-150 motion-safe:ease-[var(--ease-out)] motion-safe:[transform:translateZ(0)_scale(1)] [@media(hover:hover)_and_(pointer:fine)_and_(prefers-reduced-motion:no-preference)]:hover:[transform:translateZ(0)_scale(1.01)]"
                >
                  <HeroWordmark
                    src={show.logo}
                    alt={`${show.name} logo`}
                    movieName={show.name || ""}
                    className="w-full"
                  />
                </IntentLink>
              </div>
            )}
            <BackdropTransition />
          </div>
        </div>

        <div className={`${backdropStyles.content} ${titleStyles.content} relative z-10 px-4 md:px-6 md:mx-4 pb-6`}>
          <div
            id="stream-loading-pill-anchor"
            className="absolute top-4 right-4 z-30 pointer-events-none"
          />
          {children}
        </div>

        {cast}
        {recommendations}
      </div>
  );
}
