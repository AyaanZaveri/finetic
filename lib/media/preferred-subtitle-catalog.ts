import { isEnglishSubtitle, isForcedSubtitle, isSDHSubtitle, type SubtitlePreferenceTrack } from "./subtitle-preference";

/** A complete English SDH catalog can serve Navigator without waiting for
 * unrelated providers. The player still requests the complete language list. */
export function firstEnglishSDHCatalog<T extends SubtitlePreferenceTrack>(groups: Promise<T[]>[],
    verify: (_tracks: T[]) => Promise<T[] | undefined> = async tracks => tracks): Promise<T[]> {
    const preferred = new Promise<T[]>(resolve => {
        for (const group of groups) void group.then(async tracks => {
            const checked = await verify(tracks);
            if (checked?.some(track => isEnglishSubtitle(track) && isSDHSubtitle(track) && !isForcedSubtitle(track))) resolve(checked);
        }).catch(() => {});
    });
    return Promise.race([preferred, Promise.all(groups).then(all => all.flat())]);
}
