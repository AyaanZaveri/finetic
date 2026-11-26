"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { ArrowRight, CalendarDays, Clock, Info, Pause, Play, Star, Tag } from "lucide-react";
import { ArtworkImage } from "@/components/artwork-image";
import { HeroWordmark } from "@/components/hero-wordmark";
import { useHomeSnapshot } from "@/components/home-snapshot-provider";
import { IntentLink } from "@/components/intent-link";
import { useMetadataIntent } from "@/components/metadata-preload";
import { ProgressiveBlur } from "@/components/motion-primitives/progressive-blur";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccountAccess } from "@/contexts/account-context";
import { usePlaybackActions } from "@/contexts/MediaPlayerContext";
import { backdropVariantUrl, mediaArtwork } from "@/lib/artwork";
import { formatHeroMetadata, heroDetailsHref, HOME_HERO_ITEM_LIMIT, selectHomeHeroItems, type HomeHeroItem } from "@/lib/home-hero";
import { projectPlaybackDetails } from "@/lib/media/playback-details";
import { preloadPlayer } from "@/lib/preload-tools";
import styles from "./home-hero.module.css";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
const subscribeReducedMotion = (change: () => void) => {
    const query = window.matchMedia(reducedMotionQuery);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
};
const subscribeVisibility = (change: () => void) => {
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
};
function backdropSrcSet(source?: string): string | undefined {
    if (!source?.startsWith("https://image.tmdb.org/t/p/")) return undefined;
    return ([780, 1280] as const)
        .map((width) => `${backdropVariantUrl(source, width)} ${width}w`)
        .join(", ");
}

function heroDotsWidth(count: number) {
    return `calc(${count} * var(--hero-dot-slot) + var(--hero-active-extra))`;
}

function heroDotTransform(index: number, activeIndex: number) {
    return `translateX(calc(${index} * var(--hero-dot-slot) + ${index === activeIndex ? 0.5 : index > activeIndex ? 1 : 0} * var(--hero-active-extra)))`;
}

export function HomeHero({ items }: { items: HomeHeroItem[] }) {
    const { authenticated, requestSignIn } = useAccountAccess();
    const { playMedia, setIsPlayerVisible } = usePlaybackActions();

    const [selection, setSelection] = useState<{
        index: number; displayed: number; ready: string[]; progressVersions: Record<number, number>;
    }>({ index: 0, displayed: 0, ready: [], progressVersions: {} });
    const [failedLogos, setFailedLogos] = useState<string[]>([]);
    const [rotationOverride, setRotationOverride] = useState<boolean | null>(null);
    const [actionHovered, setActionHovered] = useState(false);
    const [heroVisible, setHeroVisible] = useState(true);
    const heroRef = useRef<HTMLElement>(null);
    const reducedMotion = useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(reducedMotionQuery).matches, () => false);
    const pageVisible = useSyncExternalStore(subscribeVisibility, () => !document.hidden, () => false);
    const rotating = rotationOverride ?? !reducedMotion;
    const count = items.length;
    useEffect(() => {
        const hero = heroRef.current;
        if (!hero || count < 2 || typeof IntersectionObserver === "undefined") return;
        const observer = new IntersectionObserver(([entry]) => setHeroVisible(entry.isIntersecting && entry.intersectionRatio >= 0.4), { threshold: [0, 0.4] });
        observer.observe(hero);
        return () => observer.disconnect();
    }, [count]);
    const requestedIndex = count > 0 ? ((selection.index % count) + count) % count : 0;
    const activeIndex = count > 0 ? ((selection.displayed % count) + count) % count : 0;
    const activeItem = count > 0 ? items[activeIndex] : null;
    const artwork = activeItem ? mediaArtwork(activeItem) : null;
    const running = rotating && pageVisible && heroVisible && !actionHovered && requestedIndex === activeIndex
        && Boolean(artwork?.background && selection.ready.includes(artwork.background));
    const detailsHref = activeItem ? heroDetailsHref(activeItem) : "/";

    const metadataIntent = useMetadataIntent(
        activeItem
            ? {
                id: activeItem.id,
                name: activeItem.name,
                type: activeItem.type,
                seriesId: activeItem.type === "series" ? activeItem.id : undefined,
                details: activeItem,
                backdropUrl: artwork?.background,
            }
            : { id: "", name: "", type: "movie" },
    );

    const selectIndex = useCallback(
        (nextRaw: number) => {
            if (count < 2) return;
            const nextIndex = ((nextRaw % count) + count) % count;
            const source = mediaArtwork(items[nextIndex]).background;
            setSelection((previous) => {
                if (nextIndex === previous.index) return previous;
                return {
                    ...previous,
                    index: nextIndex,
                    displayed: source && previous.ready.includes(source) ? nextIndex : previous.displayed,
                    progressVersions: { ...previous.progressVersions, [nextIndex]: (previous.progressVersions[nextIndex] ?? 0) + 1 },
                };
            });
        },
        [count, items],
    );

    const settleBackdrop = useCallback((index: number, source: string) => {
        setSelection(previous => {
            const ready = previous.ready.includes(source) ? previous.ready : [...previous.ready, source];
            const displayed = previous.index === index ? index : previous.displayed;
            return ready === previous.ready && displayed === previous.displayed ? previous : { ...previous, ready, displayed };
        });
    }, []);

    const handlePlay = async (event: MouseEvent<HTMLButtonElement>) => {
        if (!activeItem) return;
        if (!authenticated) {
            requestSignIn();
            return;
        }
        await playMedia({
            details: projectPlaybackDetails(activeItem),
            detailsPath: detailsHref,
            animateEntrance: event.detail > 0,
            id: activeItem.id,
            name: activeItem.name,
            type: activeItem.type,
            seriesId: activeItem.type === "series" ? activeItem.id : undefined,
            showName: activeItem.type === "series" ? activeItem.name : undefined,
            backdropUrl: artwork?.background,
        });
        setIsPlayerVisible(true);
    };

    if (!activeItem || !artwork?.background) return null;

    const renderTitleCopy = (item: HomeHeroItem, index: number) => {
        const itemArtwork = mediaArtwork(item);
        const metadata = formatHeroMetadata(item);
        const showLogo = Boolean(itemArtwork.logo && !failedLogos.includes(itemArtwork.logo));
        const hasFacts = Boolean(metadata.year || metadata.runtime || metadata.rating);
        return (
            <div key={`${item.type}:${item.id}`} className={styles.copyPanel}
                data-active={index === activeIndex ? "true" : undefined}
                aria-hidden={index !== activeIndex || undefined} inert={index !== activeIndex}
            >
                {showLogo && itemArtwork.logo ? (
                    <>
                        <h2 className="sr-only">{item.name}</h2>
                        <HeroWordmark
                            src={itemArtwork.logo}
                            alt=""
                            movieName={item.name}
                            className={styles.wordmark}
                            onError={() =>
                                setFailedLogos((previous) =>
                                    previous.includes(itemArtwork.logo!) ? previous : [...previous, itemArtwork.logo!],
                                )
                            }
                        />
                    </>
                ) : (
                    <h2 className={styles.titleFallback}>{item.name}</h2>
                )}

                {(hasFacts || metadata.genres.length > 0) && (
                    <div className={styles.metadata}>
                        {hasFacts && <div className={styles.metaFacts}>
                            {metadata.rating && <span className={styles.fact}
                                aria-label={metadata.rating.label} title={metadata.rating.label}>
                                <Star aria-hidden="true" className="size-3.5 fill-yellow-400 text-yellow-400" />
                                <span>{metadata.rating.value}</span>
                            </span>}
                            {metadata.year && <span className={styles.fact}>
                                <CalendarDays aria-hidden="true" className={styles.factIcon} />
                                <span>{metadata.year}</span>
                            </span>}
                            {metadata.runtime && <span className={styles.fact}>
                                <Clock aria-hidden="true" className={styles.factIcon} />
                                <span>{metadata.runtime}</span>
                            </span>}
                        </div>}
                        {metadata.genres.length > 0 && (
                            <span className={styles.genres}>
                                <Tag aria-hidden="true" className={styles.factIcon} />
                                <span>{metadata.genres.map((genre, index) => (
                                    <span key={`${genre}:${index}`}>
                                        {index > 0 && <span aria-hidden="true" className={styles.genreSeparator}> · </span>}
                                        {genre}
                                    </span>
                                ))}</span>
                            </span>
                        )}
                    </div>
                )}

                {item.description && (
                    <p className={styles.synopsis}>{item.description}</p>
                )}

            </div>
        );
    };

    return (
        <section
            ref={heroRef}
            data-home-hero=""
            data-aurora-primary={artwork.background}
            data-aurora-fallback={artwork.poster}
            aria-label="Featured titles"
            aria-roledescription={count > 1 ? "carousel" : undefined}
            className={styles.hero}
        >
            <div className={styles.stage} aria-hidden="true">
                <div className={styles.backdropLayer}>
                    {/* Mount all responsive images up front. Hidden slides keep their
                        decoded artwork mounted instead of requesting it on selection. */}
                    {items.map((item, index) => {
                        const source = mediaArtwork(item).background;
                        if (!source) return null;
                        return (
                            <div key={`${item.type}:${item.id}:${source}`} className={styles.backdropSlide}
                                data-hero-backdrop-active={index === activeIndex && selection.ready.includes(source) ? "true" : undefined}>
                                <ArtworkImage
                                    src={source}
                                    srcSet={backdropSrcSet(source)}
                                    sizes="100vw"
                                    width={1280}
                                    height={720}
                                    alt=""
                                    draggable={false}
                                    loading="eager"
                                    fetchPriority={index === 0 ? "high" : "auto"}
                                    decoding="async"
                                    waitForDecode
                                    reveal={false}
                                    onReady={() => settleBackdrop(index, source)}
                                    onUnavailable={() => settleBackdrop(index, source)}
                                    data-header-backdrop=""
                                    className={styles.artwork}
                                />
                            </div>
                        );
                    })}
                </div>

                <div className={styles.bottomBlur}>
                    <ProgressiveBlur
                        direction="bottom"
                        blurLayers={5}
                        blurIntensity={2.8}
                        className={styles.progressiveBlur}
                    />
                </div>
                <div data-header-backdrop-fade="" className={styles.topScrim} />
                <div data-header-backdrop-fade="" className={styles.contentScrim} />
                <div data-header-backdrop-fade="" className={styles.stageFade} />
            </div>

            <div className={styles.content}>
                <div className={styles.copy}
                    aria-live={rotating ? "off" : "polite"}
                    onFocusCapture={() => setRotationOverride(false)}
                >
                    <div className={styles.copyStack}>
                        {items.map(renderTitleCopy)}
                    </div>

                    <div className={styles.actions}>
                        <Button
                            type="button"
                            variant="media-primary"
                            size="lg"
                            className={styles.playButton}
                            aria-label={authenticated ? `Play ${activeItem.name}` : `Sign in to play ${activeItem.name}`}
                            onPointerEnter={(event) => {
                                if (event.pointerType === "mouse") setActionHovered(true);
                                if (!authenticated) return;
                                preloadPlayer();
                                metadataIntent.start();
                            }}
                            onFocus={() => {
                                if (!authenticated) return;
                                preloadPlayer();
                                metadataIntent.start();
                            }}
                            onPointerLeave={() => { setActionHovered(false); metadataIntent.cancel(); }}
                            onBlur={metadataIntent.cancel}
                            onClick={handlePlay}
                        >
                            <Play aria-hidden="true" className="size-4 fill-current" />
                            <span>{authenticated ? "Play" : "Sign in to play"}</span>
                        </Button>

                        <Tooltip delayDuration={600}>
                            <TooltipTrigger asChild>
                                <Button asChild variant="media-secondary" size="icon-lg" className={styles.detailsButton}
                                    onPointerEnter={event => { if (event.pointerType === "mouse") setActionHovered(true); }}
                                    onPointerLeave={() => setActionHovered(false)}
                                >
                                    <IntentLink
                                        href={detailsHref}
                                        scroll={false}
                                        draggable={false}
                                        aria-label={`View details for ${activeItem.name}`}
                                    >
                                        <span aria-hidden="true" className={styles.detailsIcon}>
                                            <Info strokeWidth={2} className={styles.detailsInfo} />
                                            <ArrowRight strokeWidth={2} className={styles.detailsArrow} />
                                        </span>
                                    </IntentLink>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent sideOffset={8}>View details</TooltipContent>
                        </Tooltip>
                    </div>
                </div>

                {count > 1 && (
                    <div
                        className={styles.controls}
                        data-running={running ? "true" : "false"}
                        role="group"
                        aria-label="Featured title switcher"
                        onKeyDown={(event) => {
                            if (event.key === "ArrowLeft") {
                                event.preventDefault();
                                setRotationOverride(false);
                                selectIndex(requestedIndex - 1);
                            } else if (event.key === "ArrowRight") {
                                event.preventDefault();
                                setRotationOverride(false);
                                selectIndex(requestedIndex + 1);
                            }
                        }}
                    >
                        <button
                            type="button"
                            className={styles.navButton}
                            aria-label={rotating ? "Pause featured titles" : "Play featured titles"}
                            onClick={() => setRotationOverride(!rotating)}
                        >
                            {rotating ? <Pause aria-hidden="true" className="size-3.5 fill-current" /> : <Play aria-hidden="true" className="size-3.5 fill-current" />}
                        </button>
                        <div className={styles.dots} style={{ width: heroDotsWidth(count) }}>
                            {items.map((item, index) => (
                                <button
                                    key={`${item.type}:${item.id}`}
                                    type="button"
                                    className={styles.dotButton}
                                    style={{ transform: heroDotTransform(index, requestedIndex) }}
                                    aria-label={`Show featured title ${index + 1}: ${item.name}`}
                                    aria-current={index === requestedIndex ? "true" : undefined}
                                    onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) setRotationOverride(false); }}
                                    onClick={() => selectIndex(index)}
                                >
                                    <span aria-hidden="true" className={styles.dotTrack}>
                                        <span key={selection.progressVersions[index] ?? 0} className={styles.progress}
                                            onAnimationEnd={() => { if (index === requestedIndex && running) selectIndex(requestedIndex + 1); }}
                                        />
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}

export function HomeHeroSkeleton() {
    return (
        <section data-home-hero="" data-hero-loading="" aria-label="Featured titles" aria-busy="true" className={styles.hero}>
            <div aria-hidden="true" className={styles.skeletonStage} />
            <div aria-hidden="true" className={styles.content}>
                <div className={styles.copy}>
                    <div className={styles.skeletonWordmarkSlot}>
                        <Skeleton animated={false} className={styles.skeletonWordmark} />
                    </div>
                    <div className={styles.metadata}>
                        <div className={styles.metaFacts}>
                            <Skeleton animated={false} className="h-3.5 w-12" />
                            <Skeleton animated={false} className="h-3.5 w-14" />
                            <Skeleton animated={false} className="h-3.5 w-16" />
                        </div>
                        <Skeleton animated={false} className="h-3.5 w-36 max-w-full" />
                    </div>
                    <div className={styles.skeletonSynopsis}>
                        <Skeleton animated={false} className="h-2.5 w-full" />
                        <Skeleton animated={false} className="h-2.5 w-11/12" />
                    </div>
                    <div className={styles.actions}>
                        <Skeleton animated={false} className="h-10 w-24 rounded-full" />
                        <Skeleton animated={false} className="size-10 rounded-full" />
                    </div>
                </div>
                <div className={styles.controls} data-skeleton-controls="">
                    <span className={styles.navButton}>
                        <Pause aria-hidden="true" className="size-3.5 fill-current" />
                    </span>
                    <div className={styles.dots} style={{ width: heroDotsWidth(HOME_HERO_ITEM_LIMIT) }}>
                        {Array.from({ length: HOME_HERO_ITEM_LIMIT }, (_, index) => (
                            <span key={index} className={styles.dotButton}
                                style={{ transform: heroDotTransform(index, 0) }}
                                aria-current={index === 0 ? "true" : undefined}>
                                <span className={styles.dotTrack} />
                            </span>
                        ))}
                    </div>
                </div>
            </div>
            <span className="sr-only" role="status">Loading featured titles…</span>
        </section>
    );
}

export function HomeHeroPending() {
    const snapshot = useHomeSnapshot();
    const cachedItems = useMemo(() => {
        const catalogs = snapshot?.catalogs ?? [];
        return selectHomeHeroItems(
            catalogs.slice(0, 2).map(({ data }) => ({
                items: data.mediaItems,
            })),
        );
    }, [snapshot]);
    if (!cachedItems.length) return <HomeHeroSkeleton />;
    return <HomeHero items={cachedItems} />;
}
