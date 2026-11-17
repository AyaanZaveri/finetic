import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { readSession, SESSION_COOKIE } from "@/lib/server/session";

export async function proxy(request: NextRequest) {
    const path = request.nextUrl.pathname;
    const isStaticAsset =
        path.startsWith("/_next/") ||
        path.startsWith("/_vercel/") ||
        path === "/favicon.ico" ||
        path === "/manifest.json" ||
        path === "/apple-icon.png" ||
        path === "/icon0.svg" ||
        path === "/icon1.png" || path === "/manifest.webmanifest" ||
        ["/logo/", "/flags/", "/images/", "/webgpu-player/"].some(prefix => path.startsWith(prefix)) ||
        ["/file.svg", "/next.svg", "/globe.svg", "/window.svg", "/vercel.svg"].includes(path);

    if (isStaticAsset) {
        return NextResponse.next();
    }

    // Public discovery only reads TMDB. Account pages and add-on operations
    // retain their own session gates, including direct API/Server Action calls.
    const isPublicPath = path === "/" || path === "/search" || path === "/login" || path === "/settings/about"
        || /^\/person\/[1-9]\d*\/?$/.test(path)
        || /^\/movie\/tmdb(?::|%3A)[1-9]\d*\/?$/i.test(path)
        || /^\/series\/tmdb(?::|%3A)[1-9]\d*(?:\/\d+\/[1-9]\d*)?\/?$/i.test(path);

    const isAuthenticated = !!await readSession(request.cookies.get(SESSION_COOKIE)?.value);

    if (isPublicPath && isAuthenticated && path === "/login") {
        return NextResponse.redirect(new URL("/", request.nextUrl));
    }

    if (!isPublicPath && !isAuthenticated) {
        return NextResponse.redirect(new URL("/?signIn=1", request.nextUrl));
    }

    return NextResponse.next();
}

// See "Matching Paths" below to learn more, this matcher is used to apply the proxy only to specific paths
export const config = {
    matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next (Next.js internals)
     * - _vercel (Vercel analytics/speed-insights scripts)
     * Public assets are enumerated above; a dot in a media ID must not bypass authentication.
     */
        "/((?!api|_next|_vercel).*)",
    ],
};
