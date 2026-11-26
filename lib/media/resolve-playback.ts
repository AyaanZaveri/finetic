import { languageMatchScore, streamLanguagePreference } from "@/lib/media/audio-language";
import type { MediaToPlay } from "@/lib/atoms";
import type { StreamMetadata, StreamProbeBudget } from "@/lib/media/stream-metadata";
import type { StremioStream } from "@/types/stremio";
import type { PlaybackStreamRequest, PlaybackStreamSnapshot } from "@/lib/media/fetch-playback-streams";
import { parseStreamReleaseInfo } from "@/lib/media/stream-release-info";
import { audioTrackMime } from "@/lib/media/stream-codecs";
import { compareStreamCacheStatus, getStreamCacheStatus } from "@/lib/media/stream-cache-status";
import { WEB_STREAM_CHECK_TIMEOUT_MS } from "@/lib/media/playback-limits";

export type PlaybackPhase = "finding-episode" | "fetching-streams" | "checking-streams" | "loading-stream";

interface PlaybackDependencies {
    autoSelectWebStream?: boolean;
    signal?: AbortSignal;
    createStreamRequest?: (_id: string, _type: string) => PlaybackStreamRequest;
    preferredAudioLanguage?: string;
    resolveId?: (_id: string, _type: "movie" | "series") => Promise<string>;
    environment?: "web" | "native";
    inspectStream?: (_stream: StremioStream, _options: { signal: AbortSignal; budget: StreamProbeBudget }) => Promise<StreamMetadata | undefined>;
    verifyStream?: (_stream: StremioStream, _options: { signal: AbortSignal; metadata: Promise<StreamMetadata | undefined>; timeoutMs: number; onAudioLanguage: (_language: string) => void }) => Promise<"supported" | "unsupported" | "unknown">;
    onPlaybackConfirmation?: (_confirm: () => void) => () => void;
    canPlayType?: (_mime: string) => boolean;
    excludeUrls?: ReadonlySet<string>;
    onCandidates?: (_streams: StremioStream[]) => void;
    fetchStreams: (_id: string, _type: string) => Promise<StremioStream[]>;
    getNextEpisodeForSeries: (_id: string) => Promise<{
        id: string; title: string; season: number; episode: number;
        resumePositionTicks?: number;
    } | null>;
}

export const playbackPhaseLabels: Record<PlaybackPhase, string> = {
    "finding-episode": "Finding an episode…",
    "fetching-streams": "Fetching streams…",
    "checking-streams": "Checking video and audio…",
    "loading-stream": "Loading stream…",
};

/** Rank compatibility before quality: a high-resolution file with unsupported sound is not a good web source. */
export function scoreWebStream(stream: StremioStream, canPlayType?: (_mime: string) => boolean, preferredAudioLanguage = "en"): number {
    const release = parseStreamReleaseInfo(stream);
    const language = streamLanguagePreference(stream, preferredAudioLanguage);
    let score = languageScore(language);
    const supports = (mime: string) => canPlayType?.(mime) ?? false;
    const videoScores = release.videoCodecs.map(codec => {
        if (["H.264", "x264", "VP9"].includes(codec)) return 3000;
        if (["H.265", "x265"].includes(codec)) return supports('video/mp4; codecs="hvc1.1.6.L93.B0"') ? 3000 : -8000;
        if (codec === "AV1") return supports('video/mp4; codecs="av01.0.08M.08"') ? 3000 : -4000;
        return -8000;
    });
    const audioScores = release.audioCodecs.map(codec => {
        if (["AAC", "Opus", "Vorbis"].includes(codec)) return 2000;
        if (codec === "MP3") return 1800;
        if (["DDP", "EAC3"].includes(codec)) return supports('audio/mp4; codecs="ec-3"') ? 2000 : -6000;
        if (codec === "AC3") return supports('audio/mp4; codecs="ac-3"') ? 2000 : -6000;
        if (codec === "FLAC") return supports('audio/flac') ? 1500 : -3000;
        if (codec === "PCM") return supports('audio/wav') ? 1500 : -3000;
        return -10000;
    });
    // Mixed labels don't identify the default track. Conservatively rank them
    // below unambiguous compatible audio; actual track inspection decides later.
    if (videoScores.length) score += Math.min(...videoScores);
    if (audioScores.length) score += Math.min(...audioScores);
    if (["mp4", "m4v", "webm", "m3u8"].includes(release.container || "")) score += 1000;
    else if (release.container === "mkv") score -= 2000;
    else if (["avi", "m2ts", "ts"].includes(release.container || "")) score -= 6000;
    if (release.dynamicRange === "dolby-vision") score -= 5000;
    else if (release.dynamicRange) score -= 500;
    if (release.bitDepth && release.bitDepth > 8 && release.videoCodecs.some(codec => ["H.264", "x264"].includes(codec))) score -= 4000;
    if (["2160p", "4k"].includes(release.resolution || "")) score += 400;
    else if (release.resolution === "1080p") score += 300;
    else if (release.resolution === "720p") score += 200;
    else if (release.resolution === "480p") score += 100;
    if (["webdl", "webrip"].includes(release.source || "")) score += 40;
    if (release.videoOnly || release.audioOnly || release.noAudio) score -= 30000;
    if (stream.behaviorHints?.notWebReady) score -= 15000;
    if (Object.keys(stream.behaviorHints?.proxyHeaders?.request || {}).length) score -= 20000;
    if (!stream.url) score -= 6000;
    return score;
}

function languageScore(preference: number): number {
    return preference > 0 ? 3000 + preference * 1000 : preference * 5000;
}

/** A container can declare multiple tracks; check its primary audio, not any AAC tag in a release name. */
export function webMetadataSupport(metadata: StreamMetadata, canPlayType: (_mime: string) => boolean): "supported" | "unsupported" | "unknown" {
    if (!metadata.video || !metadata.audio.length) return "unsupported";
    const video = metadata.video;
    const videoType = video.codec === "vp8" || video.codec === "vp9" ? "video/webm" : "video/mp4";
    const videoSupported = video.codecString ? canPlayType(`${videoType}; codecs="${video.codecString}"`) : undefined;
    const audio = metadata.audio.find(track => track.primary) || metadata.audio[0];
    const audioMime = audioTrackMime(audio);
    const audioSupported = audioMime ? canPlayType(audioMime) : undefined;
    if (videoSupported === false || audioSupported === false) return "unsupported";
    return videoSupported && audioSupported ? "supported" : "unknown";
}

const INITIAL_WEB_PROBES = 5;
const BACKGROUND_WEB_PROBES = 2;
const WEB_PROBE_BYTES = 8 * 1024 * 1024;
const EPISODE_RELEASE_MATCH_WAIT_MS = 500;
const EXACT_RELEASE_MATCH = 102;
const GROUP_RELEASE_MATCH = 101;
const MIN_RELEASE_SIMILARITY = 80;
const RELEASE_SIMILARITY_MARGIN = 10;

function episodeReleaseProfile(filename?: string, url?: string) {
    for (const input of [filename, url]) {
        if (!input) continue;
        let name = input.split(/[?#]/, 1)[0].split(/[/\\]/).pop() || "";
        try { name = decodeURIComponent(name); } catch { /* keep the original name */ }
        name = name.replace(/\.(mkv|mp4|m4v|webm|avi|mov|ts)$/i, "").toLowerCase();
        const episode = /(^|[^a-z0-9])(?:s\d{1,3}[ ._-]*e\d{1,4}|\d{1,3}x\d{1,4})(?![a-z0-9])/.exec(name);
        if (!episode) continue;
        const show = name.slice(0, episode.index).replace(/[^a-z0-9]/g, "");
        const suffix = name.slice(episode.index + episode[0].length);
        const technical = suffix.replace(/_/g, ".").search(/\b(?:\d{3,4}p|4k|web[ .-]?(?:dl|rip)|blu[ .-]?ray|hdtv|remux)\b/i);
        if (!show || technical < 0 || /^[ ._-]*e\d/i.test(suffix)) continue;
        const groupTag = suffix.match(/-([a-z0-9]{2,})$/)?.[1];
        const group = groupTag && !/^(?:dl|rip|ray|hdr\d*|sdr|dv|hevc|avc|[hx]26[45]|aac|atmos|opus|proper|repack\d*|internal|\d+p)$/.test(groupTag)
            ? groupTag : undefined;
        const release = parseStreamReleaseInfo({ behaviorHints: { filename: name } });
        const { resolution, source, videoCodecs, audioCodecs, dynamicRange } = release;
        const technicalTags = suffix.slice(technical, group ? -(group.length + 1) : undefined);
        return {
            show, group, release,
            template: suffix.replace(/[^a-z0-9]/g, ""),
            format: JSON.stringify([resolution, source, videoCodecs, audioCodecs, dynamicRange]),
            tokens: new Set(technicalTags.match(/[a-z0-9]+/g) || []),
        };
    }
}

type EpisodeReleaseProfile = NonNullable<ReturnType<typeof episodeReleaseProfile>>;

function episodeReleaseSimilarity(active: EpisodeReleaseProfile, candidate: EpisodeReleaseProfile): number {
    if (active.group && candidate.group && active.group !== candidate.group) return 0;
    const a = active.release;
    const b = candidate.release;
    const conflictingTag = (["resolution", "source", "dynamicRange", "bitDepth"] as const)
        .some(key => a[key] !== undefined && b[key] !== undefined && a[key] !== b[key]);
    const conflictingCodecs = (["videoCodecs", "audioCodecs"] as const)
        .some(key => a[key].length && b[key].length && a[key].join() !== b[key].join());
    if (conflictingTag || conflictingCodecs) return 0;

    const shared = [...active.tokens].filter(token => candidate.tokens.has(token)).length;
    if (shared < 4) return 0;
    return 100 * shared / (active.tokens.size + candidate.tokens.size - shared);
}

function preferEpisodeRelease(reference?: MediaToPlay["episodeReleasePreference"]) {
    const active = episodeReleaseProfile(reference?.filename, reference?.url);
    if (!active) return;
    const scores = new WeakMap<StremioStream, number>();
    return (stream: StremioStream) => {
        const cached = scores.get(stream);
        if (cached !== undefined) return cached;
        const candidate = episodeReleaseProfile(stream.behaviorHints?.filename, stream.url || stream.externalUrl);
        const score = candidate?.show !== active.show ? 0
            : candidate.template === active.template ? EXACT_RELEASE_MATCH
                : active.group && candidate.group === active.group && candidate.format === active.format ? GROUP_RELEASE_MATCH
                    : episodeReleaseSimilarity(active, candidate);
        scores.set(stream, score);
        return score;
    };
}

type ReleasePreference = ReturnType<typeof preferEpisodeRelease>;

/** Only promote a clear similarity winner within an audio-language tier. */
function rankEpisodeReleases(streams: StremioStream[], languageTier: (_stream: StremioStream) => number, preference?: ReleasePreference) {
    if (!preference) return () => 0;
    const byLanguage = new Map<number, { stream: StremioStream; best: number; runnerUp: number }>();
    for (const stream of streams) {
        const score = preference(stream);
        if (!score || score >= GROUP_RELEASE_MATCH) continue;
        const tier = languageTier(stream);
        const previous = byLanguage.get(tier);
        if (!previous || score > previous.best) {
            byLanguage.set(tier, { stream, best: score, runnerUp: previous?.best ?? 0 });
        } else {
            previous.runnerUp = Math.max(previous.runnerUp, score);
        }
    }
    return (stream: StremioStream) => {
        const score = preference(stream);
        if (score >= GROUP_RELEASE_MATCH) return score;
        const winner = byLanguage.get(languageTier(stream));
        return winner?.stream === stream && score >= MIN_RELEASE_SIMILARITY
            && score - winner.runnerUp >= RELEASE_SIMILARITY_MARGIN ? score : 0;
    };
}

/** Race real audiovisual decoder checks. Unknown must never reach the main player. */
function selectFastWebStream(
    source: {
        promise: Promise<StremioStream[]>;
        subscribe(_listener: (_snapshot: { streams: StremioStream[]; complete: boolean }) => void): () => void;
    },
    dependencies: PlaybackDependencies,
    preferredLanguage: string,
    releasePreference?: ReleasePreference,
): Promise<StremioStream> {
    return new Promise((resolve, reject) => {
        const support = new Map<string, ReturnType<typeof webMetadataSupport>>();
        const decoded = new Map<string, "supported" | "unsupported" | "unknown">();
        const languages = new Map<string, string>();
        const selectedLanguages = new Map<string, string>();
        const preferredTrackAvailable = new Map<string, boolean>();
        const releaseScores = new Map<StremioStream, number>();
        const checked = new Set<string>();
        const languagePending = new Set<string>();
        let streams: StremioStream[] = [], complete = false, running = 0, selected = false, closed = false;
        let workTimer: ReturnType<typeof setTimeout> | undefined;
        let matchTimer: ReturnType<typeof setTimeout> | undefined;
        let matchWaitExpired = false;
        const pool = new AbortController();
        const budget: StreamProbeBudget = { remainingBytes: WEB_PROBE_BYTES };
        let workStopped = false, playbackConfirmed = false;
        let workStartedAt: number | undefined;
        let selectedUrl: string | undefined;
        let removeConfirmation: (() => void) | undefined;
        let probeLimit = INITIAL_WEB_PROBES;
        let unsubscribe: (() => void) | undefined;
        const urlOf = (stream: StremioStream) => (stream.url || stream.externalUrl)!;
        const languageFor = (stream: StremioStream) => selectedLanguages.get(urlOf(stream)) || languages.get(urlOf(stream));
        const languageTier = (stream: StremioStream) => {
            const actual = languageFor(stream);
            if (actual) return languageMatchScore(actual, preferredLanguage) > 0 ? 2 : -1;
            const label = streamLanguagePreference(stream, preferredLanguage);
            // A multi-language label doesn't establish which track is selected.
            return label > 1 ? 1 : label < 0 ? -1 : 0;
        };
        const score = (stream: StremioStream) => {
            const language = languageFor(stream);
            if (!releaseScores.has(stream)) releaseScores.set(stream, scoreWebStream(stream, dependencies.canPlayType, preferredLanguage));
            return releaseScores.get(stream)!
                + (language ? languageScore(languageMatchScore(language, preferredLanguage) ? 2 : -1)
                    - languageScore(streamLanguagePreference(stream, preferredLanguage)) : 0)
                + (support.get(urlOf(stream)) === "supported" ? 2000 : 0);
        };
        const ranked = () => {
            const seen = new Set<string>();
            return streams.filter(stream => {
                const url = urlOf(stream);
                if (!/^https?:\/\//i.test(url || "") || seen.has(url) || dependencies.excludeUrls?.has(url)
                    || decoded.get(url) === "unsupported" || getStreamCacheStatus(stream) === "uncached") return false;
                seen.add(url);
                return true;
            });
        };
        const cleanup = () => {
            closed = true;
            clearTimeout(workTimer);
            clearTimeout(matchTimer);
            pool.abort();
            removeConfirmation?.();
            unsubscribe?.();
            dependencies.signal?.removeEventListener("abort", abort);
        };
        const abort = () => {
            cleanup();
            if (!selected) reject(dependencies.signal?.reason || new Error("Playback selection cancelled"));
        };
        const choose = (stream: StremioStream) => {
            if (selected) return;
            selected = true;
            selectedUrl = urlOf(stream);
            probeLimit = BACKGROUND_WEB_PROBES;
            resolve(stream);
        };
        const update = () => {
            if (closed) return;
            const candidates = ranked();
            const releaseRank = rankEpisodeReleases(candidates, languageTier, releasePreference);
            const byRelease = (a: StremioStream, b: StremioStream) => releaseRank(b) - releaseRank(a);
            // Probe release matches early. Final selection below still checks language and decoding.
            candidates.sort((a, b) => compareStreamCacheStatus(a, b) || byRelease(a, b) || score(b) - score(a));
            dependencies.onCandidates?.(candidates);
            // Fast cached/CORS results can chain microtasks ahead of timers.
            const elapsed = workStartedAt === undefined ? 0 : Date.now() - workStartedAt;
            if (elapsed >= WEB_STREAM_CHECK_TIMEOUT_MS) workStopped = true;
            if (!selected && candidates.length && workStartedAt === undefined) {
                // The budget starts with the first candidate, not before addon discovery.
                workStartedAt = Date.now();
                workTimer = setTimeout(() => {
                    workStopped = true;
                    update();
                }, WEB_STREAM_CHECK_TIMEOUT_MS);
            }
            const pending = (stream: StremioStream) => decoded.get(urlOf(stream)) === undefined || languagePending.has(urlOf(stream));
            // Give known cached streams priority while their checks can still succeed.
            const cachedCandidates = candidates.filter(stream => getStreamCacheStatus(stream) === "cached"
                && (decoded.get(urlOf(stream)) === "supported" || (!workStopped && pending(stream))));
            const eligible = cachedCandidates.length ? cachedCandidates : candidates;
            const verifiedCandidates = eligible.filter(stream => decoded.get(urlOf(stream)) === "supported"
                && (workStopped || !languagePending.has(urlOf(stream))))
                .sort((a, b) => languageTier(b) - languageTier(a) || byRelease(a, b) || score(b) - score(a));
            const preferredPending = eligible.some(stream => languageTier(stream) > 0 && pending(stream));
            const possibleMatchPending = eligible.some(stream => pending(stream)
                && (preferredTrackAvailable.get(urlOf(stream)) ?? true));
            // Don't let a fast Russian/unknown source outrun a known preferred
            // language candidate. A known other language is a last resort only.
            const verified = verifiedCandidates.find(stream => languageTier(stream) > 0)
                || (!preferredPending ? verifiedCandidates.find(stream => languageTier(stream) === 0) : undefined)
                || ((workStopped || (complete && !possibleMatchPending)) ? verifiedCandidates[0] : undefined);
            if (!selected && verified) {
                const waitingForMatch = releasePreference && !workStopped && !matchWaitExpired
                    && ((!complete && releaseRank(verified) < EXACT_RELEASE_MATCH) || candidates.some(stream =>
                        releaseRank(stream) > releaseRank(verified) && pending(stream)
                        && (languageTier(stream) >= languageTier(verified) || preferredTrackAvailable.get(urlOf(stream)) !== false)));
                if (!waitingForMatch) { clearTimeout(matchTimer); choose(verified); }
                else matchTimer ??= setTimeout(() => { matchWaitExpired = true; update(); }, EPISODE_RELEASE_MATCH_WAIT_MS);
            }
            const hasBackup = candidates.some(stream => urlOf(stream) !== selectedUrl && decoded.get(urlOf(stream)) === "supported"
                && !languagePending.has(urlOf(stream)) && languageTier(stream) >= 0);
            if (selected && (workStopped || (playbackConfirmed && hasBackup))) { cleanup(); return; }
            {
                // Walk past rejected candidates without a count cap. Pause once
                // a backup is ready; the elapsed-time and shared byte budgets
                // bound work even when an addon supplies hundreds of files.
                while (!workStopped && !(selected && hasBackup) && running < probeLimit) {
                    const candidate = candidates.find(stream => !checked.has(urlOf(stream)));
                    if (!candidate) break;
                    const url = urlOf(candidate);
                    checked.add(url);
                    running++;
                    const candidateAbort = new AbortController();
                    const cancel = () => candidateAbort.abort();
                    pool.signal.addEventListener("abort", cancel, { once: true });
                    // Share one metadata read with the playback probe. Metadata
                    // helps establish audio presence/capability, but must never
                    // cancel a successful real playback path based on MIME guesses.
                    const metadata = Promise.resolve().then(() => closed || pool.signal.aborted || budget.remainingBytes <= 0 ? undefined
                        : dependencies.inspectStream?.(candidate, { signal: candidateAbort.signal, budget })).then(metadata => {
                        if (closed || candidateAbort.signal.aborted || !metadata) return undefined;
                        const status = dependencies.canPlayType ? webMetadataSupport(metadata, dependencies.canPlayType) : "unknown";
                        support.set(url, status);
                        const language = (metadata.audio.find(track => track.primary) || metadata.audio[0])?.language;
                        if (language && !/^(und|unknown|zxx)$/i.test(language)) languages.set(url, language);
                        if (metadata.audio.some(track => languageMatchScore(track.language, preferredLanguage) > 0)) {
                            preferredTrackAvailable.set(url, true);
                        } else if (metadata.audio.length && metadata.audio.every(track => track.language && !/^(und|unknown|zxx)$/i.test(track.language))) {
                            preferredTrackAvailable.set(url, false);
                        }
                        return metadata;
                    }).catch(() => undefined);
                    void Promise.resolve().then(() => closed || pool.signal.aborted || candidateAbort.signal.aborted ? "unknown" as const
                        : dependencies.verifyStream?.(candidate, { signal: candidateAbort.signal, metadata,
                            timeoutMs: Math.max(1, WEB_STREAM_CHECK_TIMEOUT_MS - (Date.now() - workStartedAt!)),
                            onAudioLanguage: language => {
                                if (!closed && !candidateAbort.signal.aborted && typeof language === "string" && language && !/^(und|unknown|zxx)$/i.test(language)) selectedLanguages.set(url, language);
                            },
                        }) ?? "unknown" as const).then(async status => {
                        if (!closed) decoded.set(url, status);
                        // A quick video/capture success must not abort the header
                        // read before we learn that its default sound is Russian.
                        if (status === "supported" && !selectedLanguages.has(url)) {
                            languagePending.add(url);
                            await metadata;
                        }
                    }).catch(() => { if (!closed) decoded.set(url, "unknown"); }).finally(() => {
                        languagePending.delete(url);
                        candidateAbort.abort();
                        pool.signal.removeEventListener("abort", cancel);
                        running--;
                        update();
                    });
                }
            }
            if (workStopped || (complete && running === 0)) {
                cleanup();
                if (!selected) reject(new Error(workStopped ? "Stream checks timed out before playback could be confirmed. Try again."
                    : [...decoded.values()].includes("unknown") ? "The browser could not finish checking these streams. Try again."
                    : "No compatible video and audio stream was found. Try another source."));
            }
        };
        if (dependencies.signal?.aborted) { abort(); return; }
        dependencies.signal?.addEventListener("abort", abort, { once: true });
        removeConfirmation = dependencies.onPlaybackConfirmation?.(() => { playbackConfirmed = true; update(); });
        // subscribe immediately publishes its current snapshot, so cleanup can precede assignment.
        unsubscribe = source.subscribe(snapshot => {
            streams = snapshot.streams;
            complete = snapshot.complete;
            update();
        });
        if (closed) unsubscribe();
        void source.promise.catch(error => {
            if (closed) return;
            if (streams.length) { complete = true; update(); }
            else { cleanup(); if (!selected) reject(error); }
        });
    });
}

function rankNativeStreams(streams: StremioStream[], preferredAudioLanguage: string, excluded?: ReadonlySet<string>, preferences = new WeakMap<StremioStream, number>(), releasePreference?: ReleasePreference) {
    const seen = new Set<string>();
    const candidates = streams.filter(stream => {
        const url = stream.url || stream.externalUrl || "";
        if (!/^https?:\/\//i.test(url) || seen.has(url) || excluded?.has(url)) return false;
        seen.add(url);
        return true;
    });
    // Ordinary Play follows the exact add-on list order. Audio preferences
    // select a track within the chosen file, not a different file.
    if (!releasePreference) return candidates;
    for (const stream of candidates) if (!preferences.has(stream)) preferences.set(stream, streamLanguagePreference(stream, preferredAudioLanguage));
    const releaseRank = rankEpisodeReleases(candidates, stream => preferences.get(stream)!, releasePreference);
    return candidates.sort((a, b) => preferences.get(b)! - preferences.get(a)!
        || releaseRank(b) - releaseRank(a));
}

/** Commit early only when no pending add-on can change the existing winner. */
function selectNativeStream(source: PlaybackStreamRequest, dependencies: PlaybackDependencies, language: string, releasePreference?: ReleasePreference): Promise<StremioStream> {
    return new Promise((resolve, reject) => {
        let finished = false;
        const preferences = new WeakMap<StremioStream, number>();
        let matchTimer: ReturnType<typeof setTimeout> | undefined;
        let matchWaitExpired = false;
        let unsubscribe = () => {};
        const cleanup = () => { clearTimeout(matchTimer); unsubscribe(); dependencies.signal?.removeEventListener("abort", abort); };
        const fail = (error: unknown) => { if (!finished) { finished = true; cleanup(); reject(error); } };
        const abort = () => fail(dependencies.signal?.reason || new Error("Playback cancelled"));
        const update = (snapshot: PlaybackStreamSnapshot) => {
            if (finished) return;
            const candidates = rankNativeStreams(snapshot.streams, language, dependencies.excludeUrls, preferences, releasePreference);
            dependencies.onCandidates?.(candidates);
            const best = candidates[0] as (StremioStream & { addonIndex?: number }) | undefined;
            const index = best?.addonIndex;
            const prefix = snapshot.settledPrefix;
            // Ordinary Play can commit to the first playable source as soon as
            // every earlier add-on is settled. Continuation retains its release
            // match and language preference; legacy snapshots wait for completion.
            const stable = best && (!releasePreference || preferences.get(best) === 2)
                && typeof index === "number" && Number.isInteger(index) && index >= 0
                && typeof prefix === "number" && Number.isInteger(prefix) && prefix <= snapshot.total && index < prefix;
            if (!snapshot.complete && !stable) return;
            if (!snapshot.complete && !matchWaitExpired && best && releasePreference && releasePreference(best) < EXACT_RELEASE_MATCH) {
                matchTimer ??= setTimeout(() => { matchWaitExpired = true; update(source.snapshot); }, EPISODE_RELEASE_MATCH_WAIT_MS);
                return;
            }
            if (!best) { fail(new Error("No playable streams found. Try another title or check your add-ons.")); return; }
            finished = true; cleanup(); resolve(best);
        };
        // Discovery remains shared after early selection; consume its eventual
        // rejection without letting it override an already playing source.
        source.promise.then(streams => update({ ...source.snapshot, streams, complete: true }), fail);
        if (dependencies.signal?.aborted) { abort(); return; }
        dependencies.signal?.addEventListener("abort", abort, { once: true });
        unsubscribe = source.subscribe(update);
        if (finished) unsubscribe(); // subscribe may synchronously publish a cache hit.
    });
}

/** Preserve provider order for ordinary Play; explicit compatibility checks and episode continuation can rank candidates. */
const invalidatedWarmups = new WeakSet<object>();
const warmupLeases = new WeakMap<object, { count: number }>();
export function invalidatePlaybackWarmup(request: PlaybackStreamRequest | undefined) {
    if (request?.invalidate) invalidatedWarmups.add(request);
    request?.invalidate?.();
    if (request?.speculative) { invalidatedWarmups.add(request); request.cancel?.(); }
}
export async function resolvePlayback(
    request: MediaToPlay,
    dependencies: PlaybackDependencies,
    onPhase: (_phase: PlaybackPhase) => void,
    onTargetReady?: (_media: MediaToPlay) => void,
): Promise<MediaToPlay> {
    const candidate = request.streamRequest?.speculative ? request.streamRequest : undefined;
    const warmup = candidate && !invalidatedWarmups.has(candidate) ? candidate : undefined;
    if (request.streamRequest && invalidatedWarmups.has(request.streamRequest)) request = { ...request, streamRequest: undefined };
    if (dependencies.signal?.aborted) {
        // A shared lookup may settle after this caller has already cancelled.
        void request.streamRequest?.promise.catch(() => {});
        if (warmup) queueMicrotask(() => { if (!warmupLeases.get(warmup)?.count) warmup.cancel?.(); });
        dependencies.signal.throwIfAborted();
    }
    const releaseShared = request.streamRequest?.retain?.(dependencies.signal);
    if (releaseShared) void request.streamRequest!.promise.then(releaseShared, releaseShared);
    if (warmup && !warmup.retain && dependencies.signal && warmup.cancel) {
        const signal = dependencies.signal;
        const lease = warmupLeases.get(warmup) ?? { count: 0 };
        warmupLeases.set(warmup, lease); lease.count++;
        let active = true;
        const release = (aborted = false) => {
            if (!active) return;
            active = false; lease.count--; signal.removeEventListener("abort", abort);
            // Strict Mode cleanup/setup and immediate playback handoffs can
            // rejoin the same unfinished request before this microtask runs.
            if (aborted) queueMicrotask(() => { if (!lease.count) warmup.cancel?.(); });
        };
        const abort = () => release(true);
        signal.addEventListener("abort", abort, { once: true });
        void warmup.promise.then(() => release(), () => release());
    }
    try { return await resolvePlaybackAttempt(request, dependencies, onPhase, onTargetReady); }
    catch (error) {
        if (!warmup || dependencies.signal?.aborted || request.streamUrl) throw error;
        invalidatePlaybackWarmup(warmup);
        return resolvePlaybackAttempt({ ...request, streamRequest: undefined }, dependencies, onPhase, onTargetReady);
    }
}

async function resolvePlaybackAttempt(
    request: MediaToPlay,
    dependencies: PlaybackDependencies,
    onPhase: (_phase: PlaybackPhase) => void,
    onTargetReady?: (_media: MediaToPlay) => void,
): Promise<MediaToPlay> {
    const preferredAudioLanguage = dependencies.preferredAudioLanguage || "en";
    let media = { ...request };
    const shared = request.streamRequest;
    const targetId = request.mediaSourceId || request.id;
    // A page may have started discovery under a TMDB id before playback canonicalized it.
    const knownStreams = shared && shared.type === request.type && (shared.id === targetId
        || (!request.streamUrl && await shared.canonicalId === targetId)) ? shared : undefined;
    const tmdb = /^(tmdb:[1-9]\d*)(?::\d+:\d+)?$/.exec(media.seriesId || media.id);
    if (tmdb && dependencies.resolveId && (media.type === "movie" || media.type === "series")) {
        const canonicalTarget = knownStreams ? await knownStreams.canonicalId : undefined;
        const knownImdb = /^tt\d+$/.test(media.details?.imdbId || "") ? media.details!.imdbId : undefined;
        const id = canonicalTarget ? canonicalTarget.replace(/:(\d+):(\d+)$/, '') : knownImdb || await dependencies.resolveId(tmdb[1], media.type);
        media = { ...media, id, seriesId: media.type === "series" ? id : undefined,
            mediaSourceId: media.mediaSourceId?.replace(/^tmdb:[1-9]\d*(?=:|$)/, id) };
    }
    if (!media.streamUrl && media.type === "series" && !media.mediaSourceId) {
        onPhase("finding-episode");
        const seriesId = media.seriesId || media.id;
        const episode = await dependencies.getNextEpisodeForSeries(seriesId);
        if (!episode) throw new Error("No episode is available to play. Choose another title.");
        media = {
            ...media, id: seriesId, seriesId, showName: media.showName || media.name,
            name: episode.title, episodeTitle: episode.title,
            mediaSourceId: episode.id, seasonNumber: episode.season,
            episodeNumber: episode.episode, resumePositionTicks: episode.resumePositionTicks,
        };
    }
    onTargetReady?.(media);
    if (media.streamUrl) {
        const checked = media.preparedWebStream;
        const alreadyChecked = checked?.url === media.streamUrl && checked.audioLanguage === preferredAudioLanguage
            && checked.headersKey === JSON.stringify(media.requestHeaders || {}) && checked.expires > Date.now();
        if (dependencies.environment === "web" && dependencies.autoSelectWebStream === true && !alreadyChecked) {
            onPhase("checking-streams");
            // Manual selection chooses the URL, not permission to skip A/V checks.
            const stream: StremioStream = { url: media.streamUrl,
                behaviorHints: { proxyHeaders: { request: media.requestHeaders || {} } } };
            await selectFastWebStream({ promise: Promise.resolve([stream]), subscribe(listener) {
                listener({ streams: [stream], complete: true }); return () => {};
            } }, { ...dependencies, onCandidates: undefined, onPlaybackConfirmation: undefined }, preferredAudioLanguage);
        }
        onPhase("loading-stream");
        return media;
    }
    onPhase("fetching-streams");
    const releasePreference = preferEpisodeRelease(media.episodeReleasePreference);
    const autoSelectWebStream = dependencies.environment === "web" && dependencies.autoSelectWebStream === true;
    const progressive = knownStreams || (autoSelectWebStream || dependencies.environment === "native"
        ? dependencies.createStreamRequest?.(media.mediaSourceId || media.id, media.type) : undefined);
    if (autoSelectWebStream) {
        const source = progressive || await (async () => {
            const streams = await dependencies.fetchStreams(media.mediaSourceId || media.id, media.type);
            const snapshot = { streams, complete: true, pending: 0, total: 0 };
            return {
                snapshot,
                promise: Promise.resolve(streams),
                subscribe(listener: (_snapshot: { streams: StremioStream[]; complete: boolean; pending: number; total: number }) => void) {
                    listener(snapshot);
                    return () => {};
                },
            };
        })();
        onPhase("checking-streams");
        const stream = await selectFastWebStream(source, dependencies, preferredAudioLanguage, releasePreference);
        onPhase("loading-stream");
        return {
            ...media, streamRequest: progressive || media.streamRequest,
            streamUrl: stream.url || stream.externalUrl,
            requestHeaders: stream.behaviorHints?.proxyHeaders?.request,
            subtitleFilename: media.subtitleFilename || stream.behaviorHints?.filename,
            subtitleVideoSize: media.subtitleVideoSize ?? stream.behaviorHints?.videoSize,
        };
    }
    if (dependencies.environment === "native" && progressive) {
        const stream = await selectNativeStream(progressive, dependencies, preferredAudioLanguage, releasePreference);
        onPhase("loading-stream");
        return { ...media, streamRequest: progressive,
            streamUrl: stream.url || stream.externalUrl,
            requestHeaders: stream.behaviorHints?.proxyHeaders?.request,
            subtitleFilename: media.subtitleFilename || stream.behaviorHints?.filename,
            subtitleVideoSize: media.subtitleVideoSize ?? stream.behaviorHints?.videoSize };
    }
    const streams = knownStreams ? await knownStreams.promise
        : await dependencies.fetchStreams(media.mediaSourceId || media.id, media.type);
    const candidates = rankNativeStreams(streams, preferredAudioLanguage, dependencies.excludeUrls, undefined, releasePreference);
    dependencies.onCandidates?.(candidates);
    const stream = candidates[0];
    if (!stream) throw new Error("No playable streams found. Try another title or check your add-ons.");
    onPhase("loading-stream");
    return {
        ...media,
        streamUrl: stream.url || stream.externalUrl,
        requestHeaders: stream.behaviorHints?.proxyHeaders?.request,
        subtitleFilename: media.subtitleFilename || stream.behaviorHints?.filename,
        subtitleVideoSize: media.subtitleVideoSize ?? stream.behaviorHints?.videoSize,
    };
}
