import "server-only";
import { z } from "zod";
import { outboundFetch, outboundUrl } from "@/lib/server/outbound-fetch";
import type { StremioAddon } from "@/types/stremio";

const manifestSchema = z.object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    version: z.string().min(1),
    description: z.string(),
    logo: z.string().optional(),
    background: z.string().optional(),
    idPrefixes: z.array(z.string()).optional(),
    resources: z.array(z.union([z.string(), z.object({
        name: z.string(), types: z.array(z.string()).optional(), idPrefixes: z.array(z.string()).optional(),
    }).passthrough()])),
    types: z.array(z.string()),
    catalogs: z.array(z.object({
        id: z.string(), type: z.string(), name: z.string().optional(),
        extra: z.array(z.object({
            name: z.string(), isRequired: z.boolean().optional(),
            options: z.array(z.string()).optional(), optionsLimit: z.number().optional(),
        }).passthrough()).optional(),
    }).passthrough()),
    behaviorHints: z.object({
        adult: z.boolean().optional(), p2p: z.boolean().optional(),
        configurable: z.boolean().optional(), configurationRequired: z.boolean().optional(),
    }).passthrough().optional(),
}).passthrough();

export function addonInstallUrl(value: string): string {
    if (typeof value !== "string" || value.length > 8192) throw new Error("Enter a valid add-on manifest link");
    const url = outboundUrl(value.trim().replace(/^stremio:\/\//iu, "https://"));
    if (!/\/manifest\.json$/u.test(url.pathname)) throw new Error("Use the add-on link that ends in /manifest.json");
    return url.toString();
}

export async function loadAddonForInstall(value: string): Promise<StremioAddon> {
    const transportUrl = addonInstallUrl(value);
    let manifest;
    try {
        const response = await outboundFetch(transportUrl, {}, { maxBytes: 512 * 1024, timeoutMs: 15_000 });
        if (!response.ok) throw new Error();
        manifest = manifestSchema.safeParse(await response.json());
    } catch {
        throw new Error("Couldn’t load this add-on. Check the link and try again.");
    }
    if (!manifest.success) throw new Error("This link does not contain a valid add-on manifest");
    return { transportUrl, transportName: "http", manifest: manifest.data as StremioAddon["manifest"], flags: {} };
}
