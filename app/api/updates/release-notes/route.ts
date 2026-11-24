import { compareReleaseVersions, releaseVersionPattern } from "@/lib/app-update-notes";
import { githubReleaseHistory, githubReleaseNotes } from "@/lib/server/github-release-notes";

const cacheControl = { "Cache-Control": "public, max-age=300, s-maxage=3600" };

export async function GET(request: Request) {
    const params = new URL(request.url).searchParams;
    const version = params.get("version");
    const since = params.get("since");
    if (!version || !releaseVersionPattern.test(version)) {
        return Response.json({ error: "Invalid release version." }, { status: 400 });
    }
    if (since !== null && (!releaseVersionPattern.test(since) || compareReleaseVersions(since, version) >= 0)) {
        return Response.json({ error: "Invalid installed version." }, { status: 400 });
    }

    try {
        if (since) {
            const history = await githubReleaseHistory(since, version, request.signal);
            return Response.json(history, { headers: history.complete ? cacheControl : { "Cache-Control": "no-store" } });
        }
        const notes = await githubReleaseNotes(version, request.signal);
        if (!notes) return Response.json({ notes: "" }, { status: 404 });
        return Response.json({ notes }, { headers: cacheControl });
    } catch {
        return Response.json({ notes: "" }, { status: 502 });
    }
}
