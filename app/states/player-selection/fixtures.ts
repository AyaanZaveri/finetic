import type { Episode, Season } from "@/app/actions/tv-shows";
import type { StremioStream } from "@/types/stremio";

export const groups = [
    { title: "Player", states: [
        { id: "closed", label: "Episode toolbar" },
        { id: "movie", label: "Movie toolbar" },
        { id: "playing", label: "Auto-hide controls" },
        { id: "up-next", label: "Up Next" },
        { id: "chapters", label: "Chapter drawer" },
    ] },
    { title: "Track loading", states: [
        { id: "fetching-subtitles", label: "Fetching subtitles" },
        { id: "fetching-audio", label: "Fetching audio" },
    ] },
    { title: "Episodes", states: [
        { id: "episodes", label: "Playing episode" },
        { id: "episode-single", label: "One episode" },
        { id: "episode-loading", label: "Loading episodes" },
        { id: "episode-empty", label: "Empty season" },
        { id: "episode-error", label: "Episode lookup failed" },
    ] },
    { title: "Streams", states: [
        { id: "streams", label: "Available streams" },
        { id: "stream-loading", label: "Loading streams" },
        { id: "stream-partial", label: "Some add-ons still loading" },
        { id: "stream-empty", label: "No streams for this title" },
        { id: "stream-no-addons", label: "No add-ons connected" },
        { id: "stream-error", label: "Stream lookup failed" },
        { id: "stream-signed-out", label: "Sign-in required" },
    ] },
] as const;

export const states = groups.flatMap(group => [...group.states] as { id: StateId; label: string }[]);
export type StateId = typeof groups[number]["states"][number]["id"];
export const readState = (value: string | null): StateId => states.find(state => state.id === value)?.id ?? "closed";
export const panelFor = (id: StateId) => id.startsWith("episode") ? "Episodes"
    : id.startsWith("stream") ? "Streams" : id === "chapters" ? "Chapters" : null;

const seasonSix = [
    "Honeymoon", "Hitchcock & Scully", "The Tattler", "Four Movements", "A Tale of Two Bandits", "The Crime Scene",
    "The Honeypot", "He Said, She Said", "The Golden Child", "Gintars", "The Therapist", "Casecation", "The Bimbo",
    "Ticking Clocks", "Return of the King", "Cinco de Mayo", "Sicko", "Suicide Squad",
];
const seasonSeven = ["Manhunter", "Captain Kim", "Pimemento", "The Jimmy Jab Games II", "Debbie", "Trying", "Ding Dong"];
const seasonSixAirDates = [
    "01-10", "01-17", "01-24", "01-31", "02-07", "02-14", "02-21", "02-28", "03-07",
    "03-14", "03-21", "04-11", "04-18", "04-25", "05-02", "05-09", "05-16", "05-16",
];
const seasonSixStills = [
    "bLZSOzRAqO5V74D2koPksQscC3t", "sfWFDgNUDjDBo9HOgNG4tSIAk7d", "l1NZcemvW2husp07poXhHxABhmt",
    "dGbTIbYP315IkTJ20UoNeiH1IH5", "20nigWdg6hichDRKLwdBBRMxpxL", "10MdhUpcykGVTJLvy7GeVznCnuy",
    "isKURUcTgOx2V774NyltOShGlqe", "5maSCF0Yobq9gGixbFj33rGHPBw", "5z7U6f7PpeZmIJm3sH6OY6Bj3NB",
    "oZ9UMk7MKTIumOzD7DIFmeN1lZD", "likXfZnk9bhfx2IyECRuvECVcIO", "bxU2nWhLrhpde3fS0keqal5A7a2",
    "sKdBlH6oVTO70V2vvRxiIz5g6z1", "xnv8adqyfG70DQEnp9ugLHs16mp", "o4LiSkg9Izbero76SwZpon1PZ1w",
    "7V16fperXSPfFyoYVC3e2YmxCkZ", "ub4PLlJv2KGXETOQrq5JVjqKDYs", "yMu84cLYRJdfnUUxA2XF1GB45uO",
];
const seasonSevenStills = [
    "tMf1OuqIyQCgzcCSXsjWEX7vbui", "yM30bgDLlxL8vbIknbbHN9G3xZn", "ok8rYTTi1skrwHmoPtUX3VVAXux",
    "5T7aBAyWhu5rFee3WaCcgLMMQ7U", "aRvd8Fz7iE395jLkDsqa3qGdsZz", "7ST7k5QRYkMp0iqLfVrq3Enx8WQ",
];

export function fixtures(state: StateId) {
    const seriesId = `tmdb:${991000 + states.findIndex(item => item.id === state)}`;
    const currentSeason = 6;
    const currentEpisode = state === "episode-single" ? 1 : 9;
    const seasons: Season[] = [{ number: 6, name: "Season 6", episodeCount: seasonSix.length },
        { number: 7, name: "Season 7", episodeCount: seasonSeven.length }];
    function episodes(season: number): Episode[] {
        if (state === "episode-empty") return [];
        const names = season === 7 ? seasonSeven : state === "episode-single" ? seasonSix.slice(0, 1) : seasonSix;
        const stills = season === 7 ? seasonSevenStills : seasonSixStills;
        return names.map((title, index) => {
            const still = stills[index];
            return {
                id: `${seriesId}:${season}:${index + 1}`, season, episode: index + 1, title,
                thumbnail: still ? `https://image.tmdb.org/t/p/w500/${still}.jpg` : undefined,
                ...(season === 6 ? { runtime: 22, released: `2019-${seasonSixAirDates[index]}` } : {}),
                ...(season === 7 && index === names.length - 1 ? { released: "2099-01-01" } : {}),
            };
        });
    }
    const currentStream = "https://stream.example/brooklyn-nine-nine-1080p.mp4";
    const streams: StremioStream[] = [
        { url: currentStream, name: "Archive • 1080p", title: "1080p WEB-DL · H.264 · English 5.1",
            behaviorHints: { filename: "Brooklyn.Nine-Nine.S06E09.1080p.WEB-DL.H264.mkv", videoSize: 1_318_000_000 } },
        { url: "https://stream.example/brooklyn-nine-nine-720p.mp4", name: "Archive • 720p", title: "720p WEBRip · H.264 · English stereo" },
        { url: "https://stream.example/brooklyn-nine-nine-alt.mp4", name: "Relay • 1080p", title: "1080p WEB-DL · HEVC · English / Spanish" },
        { name: "Relay • 480p", title: "480p · No playable URL" },
    ];
    const trackLoadingLabel = state === "fetching-subtitles" ? "Fetching subtitles"
        : state === "fetching-audio" ? "Fetching audio" : null;
    return { seriesId, currentSeason, currentEpisode, seasons, episodes, currentStream, streams, trackLoadingLabel };
}

export function installFixtureFetch(state: StateId, data: ReturnType<typeof fixtures>) {
    const previous = window.fetch;
    const teardown = new AbortController();
    // Only this isolated stage frame uses these mock responses. Park loading
    // fixtures until teardown so the switcher controls when they leave loading.
    const pending = () => new Promise<Response>((_resolve, reject) => {
        teardown.signal.addEventListener("abort", () => reject(teardown.signal.reason), { once: true });
    });
    const mock = Object.assign((...args: Parameters<typeof previous>): Promise<Response> => {
        const [resource, options] = args;
        const url = new URL(resource instanceof Request ? resource.url : String(resource), window.location.href);
        if (url.origin !== window.location.origin) return previous(resource, options);
        const reply = (value: unknown) => Promise.resolve(Response.json(value));
        const failed = () => Promise.resolve(new Response(null, { status: 503 }));
        if (url.pathname === "/states/player-selection" && options?.method === "POST"
            && new Headers(options.headers).has("Next-Action") && typeof options.body === "string"
            && options.body.includes(JSON.stringify(data.seriesId))) {
            // A minimal Flight action result with no navigation payload.
            return Promise.resolve(new Response(`0:${JSON.stringify({ a: data.seasons })}\n`, { headers: { "Content-Type": "text/x-component" } }));
        }
        if (url.pathname === "/api/series/episodes" && url.searchParams.get("id") === data.seriesId) {
            if (state === "episode-loading") return pending();
            if (state === "episode-error") return failed();
            return reply(data.episodes(Number(url.searchParams.get("season"))));
        }
        if (url.pathname === "/api/playback/id" && url.searchParams.get("id") === data.seriesId) return reply({ id: "tt2467372" });
        if (url.pathname === "/api/streams/addons") {
            if (state === "stream-error") return failed();
            return reply({ addons: state === "stream-no-addons" ? [] : [
                { id: "archive", name: "Archive" }, { id: "relay", name: "Relay" },
            ] });
        }
        if (url.pathname === "/api/streams/addon") {
            const relay = url.searchParams.get("addonId") === "relay";
            if (state === "stream-loading" || (state === "stream-partial" && relay)) return pending();
            return reply({ streams: state === "stream-empty" ? [] : relay ? data.streams.slice(2) : data.streams.slice(0, 2) });
        }
        return previous(resource, options);
    }, previous);
    window.fetch = mock;
    return () => {
        if (window.fetch === mock) window.fetch = previous;
        teardown.abort();
    };
}
