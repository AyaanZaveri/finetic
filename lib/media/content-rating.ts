export interface ContentRating {
    value: string;
    region: string;
}

type TMDBReleaseDates = {
    results?: { iso_3166_1: string; release_dates?: { certification?: string; type?: number }[] }[];
};
type TMDBContentRatings = {
    results?: { iso_3166_1: string; rating?: string }[];
};

export interface TMDBCertificationData {
    release_dates?: TMDBReleaseDates;
    content_ratings?: TMDBContentRatings;
}

/** Keep certification codes distinct from audience scores. Use US codes only,
 * rather than silently substituting a different country's classification. */
export function tmdbContentRating(data: TMDBCertificationData, type: "movie" | "series"): ContentRating | undefined {
    const region = "US";
    const codes = type === "movie"
        ? ["G", "PG", "PG-13", "R", "NC-17", "X"]
        : ["TV-Y", "TV-Y7", "TV-Y7-FV", "TV-G", "TV-PG", "TV-14", "TV-MA"];
    const valid = (input: unknown) => {
        if (typeof input !== "string") return undefined;
        const value = input.trim();
        return codes.includes(value) ? value : undefined;
    };
    const releasePriority = (type?: number) => {
        const index = [3, 2, 1, 4, 5, 6].indexOf(type ?? 0);
        return index < 0 ? 6 : index;
    };
    const movies = data.release_dates?.results;
    const shows = data.content_ratings?.results;
    const value = type === "movie"
        ? (Array.isArray(movies) ? movies : [])
            .filter(result => result?.iso_3166_1 === region)
            .flatMap(result => Array.isArray(result.release_dates) ? result.release_dates.filter(Boolean) : [])
            // Prefer the general theatrical release, then limited theatrical,
            // premiere, digital, physical and TV releases.
            .sort((a, b) => releasePriority(a.type) - releasePriority(b.type))
            .map(release => valid(release.certification)).find(Boolean)
        : (Array.isArray(shows) ? shows : [])
            .filter(result => result?.iso_3166_1 === region)
            .map(result => valid(result.rating)).find(Boolean);
    return value ? { value, region } : undefined;
}
