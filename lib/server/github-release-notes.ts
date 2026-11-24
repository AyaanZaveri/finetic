import "server-only";
import { parse, type DefaultTreeAdapterTypes } from "parse5";
import {
    appReleasesUrl, appReleaseUrl, compareReleaseVersions, isReleaseHighlightsHeading, releaseHighlights,
    releaseVersionPattern, type ReleaseHistory, type ReleaseNotes,
} from "@/lib/app-update-notes";
import { outboundFetch } from "./outbound-fetch";

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
const releasesApi = "https://api.github.com/repos/AyaanZaveri/navigator/releases";
const apiHeaders = { Accept: "application/vnd.github+json", "User-Agent": "Navigator-Release-Notes" };

function* elements(node: Node): Generator<Element> {
    if ("tagName" in node) yield node;
    if ("childNodes" in node) {
        for (const child of node.childNodes) yield* elements(child);
    }
}

function attr(element: Element, name: string) {
    return element.attrs.find(attribute => attribute.name === name)?.value;
}

function textContent(node: Node): string {
    if ("value" in node) return node.value;
    if ("tagName" in node && ["script", "style"].includes(node.tagName)) return "";
    return "childNodes" in node ? node.childNodes.map(textContent).join("") : "";
}

function markdownText(node: Node) {
    return textContent(node).replace(/\s+/g, " ").trim().replace(/[\\`*_{}\[\]<>&]/g, "\\$&");
}

function markdownList(element: Element) {
    return element.childNodes.flatMap(child => {
        if (!("tagName" in child) || child.tagName !== "li") return [];
        const [first, ...rest] = child.childNodes;
        return first && "tagName" in first && first.tagName === "strong"
            ? [`- **${markdownText(first)}** ${rest.map(markdownText).join(" ")}`]
            : [`- ${markdownText(child)}`];
    }).join("\n");
}

function releaseHighlightsFromPage(root: Node) {
    const body = [...elements(root)].find(element => attr(element, "data-test-selector") === "body-content"
        && attr(element, "class")?.split(/\s+/).includes("markdown-body"));
    if (!body) return "";
    const paragraphs: string[] = [];
    let structured = false;
    let inHighlights = false;
    let openingList = "";
    for (const element of body.childNodes) {
        if (!("tagName" in element)) continue;
        if (/^h[1-3]$/.test(element.tagName)) {
            structured ||= element.tagName !== "h1";
            inHighlights = isReleaseHighlightsHeading(textContent(element));
        } else if (inHighlights && element.tagName === "p") {
            paragraphs.push(markdownText(element));
        } else if (["ul", "ol"].includes(element.tagName)) {
            if (inHighlights) paragraphs.push(markdownList(element));
            else if (!structured && !openingList) openingList = markdownList(element);
        }
    }
    return paragraphs.filter(Boolean).join("\n\n") || (structured ? "" : openingList);
}

export async function githubReleaseNotes(version: string, signal: AbortSignal) {
    const tag = `release-v${version}`;
    const init = { redirect: "error", signal } as const;
    try {
        const response = await outboundFetch(`${releasesApi}/tags/${tag}`, {
            ...init, headers: apiHeaders,
        }, { timeoutMs: 3500, maxBytes: 256 * 1024 });
        if (response.ok) {
            const data = await response.json();
            if (data?.tag_name === tag && data.draft === false && typeof data.body === "string") return releaseHighlights(data.body);
        } else if (response.status === 404) {
            return "";
        }
    } catch {
        // The public release page works without an API token or API quota.
    }
    signal.throwIfAborted();
    const page = await outboundFetch(appReleaseUrl(version), init, { timeoutMs: 4500, maxBytes: 512 * 1024 });
    return page.ok ? releaseHighlightsFromPage(parse(await page.text())) : "";
}

async function listReleaseNotesFromApi(inRange: (_version: string) => boolean, target: string, signal: AbortSignal) {
    const releases: ReleaseNotes[] = [];
    for (let page = 1; ; page++) {
        const response = await outboundFetch(`${releasesApi}?per_page=100&page=${page}`, {
            headers: apiHeaders, redirect: "error", signal,
        }, { timeoutMs: 3500, maxBytes: 2 * 1024 * 1024 });
        if (!response.ok) break;
        const entries = await response.json();
        if (!Array.isArray(entries)) break;
        for (const entry of entries) {
            const version = /^release-v(.+)$/.exec(entry?.tag_name)?.[1];
            if (!version || !inRange(version) || entry.draft !== false || (entry.prerelease && version !== target)) continue;
            releases.push({ version, notes: typeof entry.body === "string" ? releaseHighlights(entry.body) : "" });
        }
        if (!/<[^>]+>;\s*rel="next"/.test(response.headers.get("link") ?? "")) return releases;
    }
}

async function listReleaseNotesFromPages(inRange: (_version: string) => boolean, target: string, signal: AbortSignal) {
    const releases: ReleaseNotes[] = [];
    for (let page = 1; ; page++) {
        const response = await outboundFetch(page === 1 ? appReleasesUrl : `${appReleasesUrl}?page=${page}`, {
            redirect: "error", signal,
        }, { timeoutMs: 4500, maxBytes: 1024 * 1024 });
        if (!response.ok) break;
        let hasNextPage = false;
        for (const element of elements(parse(await response.text()))) {
            if (element.tagName === "a" && attr(element, "rel") === "next") hasNextPage = true;
            if (element.tagName !== "section") continue;
            const version = /^release-release-v(.+)$/.exec(attr(element, "data-release-anchor") ?? "")?.[1];
            if (!version || !inRange(version)) continue;
            const prerelease = [...elements(element)].some(child => attr(child, "class")?.split(/\s+/).includes("Label--warning")
                && textContent(child).trim() === "Pre-release");
            if (prerelease && version !== target) continue;
            releases.push({ version, notes: releaseHighlightsFromPage(element) });
        }
        if (!hasNextPage) return releases;
    }
}

export async function githubReleaseHistory(since: string, target: string, signal: AbortSignal): Promise<ReleaseHistory> {
    const historySignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
    const inRange = (version: string) => releaseVersionPattern.test(version)
        && compareReleaseVersions(version, since) > 0 && compareReleaseVersions(version, target) <= 0;
    for (const list of [listReleaseNotesFromApi, listReleaseNotesFromPages]) {
        try {
            const releases = await list(inRange, target, historySignal);
            if (releases?.some(release => release.version === target)) {
                const unique = [...new Map(releases.map(release => [release.version, release])).values()];
                return { releases: unique.sort((left, right) => compareReleaseVersions(right.version, left.version)), complete: true };
            }
        } catch {
            signal.throwIfAborted();
        }
    }

    const notes = await githubReleaseNotes(target, signal);
    return { releases: notes ? [{ version: target, notes }] : [], complete: false };
}
