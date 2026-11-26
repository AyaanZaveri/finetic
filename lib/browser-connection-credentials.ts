export const CONNECTION_STORAGE_KEYS = {
    tmdb: "navigator-tmdb-token",
    tinyfish: "navigator-tinyfish-api-key",
    mdblist: "navigator-mdblist-api-key",
} as const;

export type ConnectionService = keyof typeof CONNECTION_STORAGE_KEYS;
export const CONNECTION_CREDENTIALS_EVENT = "navigator-connection-credentials";

export function readConnectionCredential(service: ConnectionService): string | undefined {
    return localStorage.getItem(CONNECTION_STORAGE_KEYS[service]) ?? undefined;
}

export function saveConnectionCredential(service: ConnectionService, value: string) {
    localStorage.setItem(CONNECTION_STORAGE_KEYS[service], value);
    window.dispatchEvent(new Event(CONNECTION_CREDENTIALS_EVENT));
}
