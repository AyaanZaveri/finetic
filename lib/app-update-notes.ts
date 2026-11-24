export const appReleasesUrl = "https://github.com/AyaanZaveri/navigator/releases";
export const releaseVersionPattern = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;

export type ReleaseNotes = { version: string; notes: string };
export type ReleaseHistory = { releases: ReleaseNotes[]; complete: boolean };

export function compareReleaseVersions(left: string, right: string) {
    const rightParts = right.split(".").map(Number);
    for (const [index, part] of left.split(".").map(Number).entries()) {
        const difference = part - rightParts[index];
        if (difference) return difference;
    }
    return 0;
}

export function appReleaseUrl(version: string | null | undefined) {
    return version && releaseVersionPattern.test(version) ? `${appReleasesUrl}/tag/release-v${version}` : appReleasesUrl;
}

export function isReleaseHighlightsHeading(heading: string) {
    return /^(new features and improvements|new features|improvements|fixes|bug fixes)$/i.test(heading.trim());
}

export function formatReleaseNotesForDialog(notes: string) {
    // The dialog displays each leading bold label on a separate line.
    const labelWithPeriod = /^([ \t]*(?:[-+*]|\d{1,9}[.)])[ \t]+\*\*[^*\r\n]*[^.*\s])\.\*\*(?=[ \t]+\S)/gm;
    return notes.replace(labelWithPeriod, "$1**");
}

export function releaseHighlights(body: string) {
    // Release notes have separate sections for installation and validation.
    const highlights = body.split(/(?=^#{1,3} )/m).flatMap(section => {
        const end = section.indexOf("\n");
        if (end < 0) return [];
        const heading = /^#{2,3} (.+)$/.exec(section.slice(0, end).trimEnd())?.[1];
        if (!heading || !isReleaseHighlightsHeading(heading)) return [];
        return [section.slice(end + 1).trim()];
    }).filter(Boolean).join("\n\n");
    if (highlights || /^#{2,3} /m.test(body)) return highlights;
    // Early releases used an opening list without a section heading.
    return body.split(/\r?\n\s*\r?\n/).map(block => block.trim()).find(block => /^[-+*] /.test(block)) ?? "";
}
