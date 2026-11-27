import type { PlaybackStreamSnapshot, StreamWithAddon } from "@/lib/media/fetch-playback-streams";
import type { StateId } from "./states";

export function streamFixture(id: StateId): PlaybackStreamSnapshot | undefined {
    if (!id.startsWith("streams-")) return undefined;
    const count = id === "streams-few" ? 2 : id === "streams-loading" || id === "streams-empty" ? 0 : id === "streams-partial" ? 84 : 250;
    const pending = id === "streams-loading" ? 3 : id === "streams-partial" ? 2 : 0;
    const providers = ["Archive", "Relay", "Cinema"];
    const streams: StreamWithAddon[] = Array.from({ length: count }, (_, index) => {
        const provider = Math.min(2, Math.floor(index / 84));
        const resolution = index % 5 < 2 ? "2160p" : index % 5 < 4 ? "1080p" : "720p";
        const source = ["BluRay", "WEB-DL", "WEBRip", "BluRay.REMUX", "HDTV", "DVDRip"][index % 6];
        const cached = index % 4 !== 3;
        const hdr = resolution === "2160p" ? ["DV.HDR10", "HDR10+", "HDR10", "DV", "HDR"][index % 5] : "SDR";
        const audio = ["TrueHD.Atmos", "DDP5.1.Atmos", "DTS-X", "DTS-HD.MA", "DDP5.1"][index % 5];
        const group = ["FLUX", "FraMeSToR", "NTb", "SPARKS", "Tigole"][index % 5];
        return {
            addonId: providers[provider].toLowerCase(),
            addonName: providers[provider],
            addonLogo: provider === 2 ? undefined : `/images/workbench-addon-${providers[provider].toLowerCase()}.svg`,
            addonIndex: provider,
            url: `https://stream.example.invalid/movie-${index + 1}.mkv`,
            name: `${resolution} ${cached ? "⚡" : "⏳"} ${source}`,
            title: `${resolution === "2160p" ? "★★★" : "★★☆"}\n${providers[provider]} · English`,
            behaviorHints: {
                filename: `Knives.Out.2019.${resolution}.${source}.${hdr}.${audio}.${["H264", "x265", "AV1"][index % 3]}-${group}.${index + 1}.mkv`,
                videoSize: Math.round((resolution === "2160p" ? 18 + index % 53 : 1.5 + index % 9) * 1024 ** 3),
            },
        };
    });
    return { streams, total: 3, pending, complete: pending === 0 };
}
