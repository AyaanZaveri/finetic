export interface SceneProgress {
    stage: "title" | "subtitles" | "scene";
    state: "running" | "completed" | "error";
    detail?: string;
    media?: {
        id: string;
        name: string;
        type: "movie" | "series" | "episode";
        year?: number;
        communityRating?: number;
        poster?: string;
        thumbnail?: string;
        background?: string;
        source?: string;
        seriesId?: string;
        seriesName?: string;
        seasonNumber?: number;
        episodeNumber?: number;
    };
    subtitles?: {
        language?: string;
        label?: string;
        filename?: string;
        provider?: string;
        index: number;
        lineCount: number;
    };
    scene?: {
        timestamp: number;
        timestampFormatted: string;
        text: string;
    };
}

export function sceneProgressLabel(progress: SceneProgress): string {
    return {
        title: { running: "Searching for the title", completed: "Found the title", error: "Could not find the title" },
        subtitles: { running: "Searching and loading subtitles", completed: "Loaded subtitles", error: "Could not load subtitles" },
        scene: { running: "Finding the scene in the dialogue", completed: "Found the scene", error: "Could not match the scene" },
    }[progress.stage][progress.state];
}
