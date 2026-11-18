import { tool } from "ai";
import { z } from "zod";
import { searchTMDBPeople, getTMDBPerson, getTMDBFilmography } from "@/lib/tmdb-discovery";

export const searchPeople = tool({
    description: "Search TMDB for actors, directors, writers, and other people by name. Returns numeric TMDB person IDs and known-for titles. Use before requesting a person's biography or filmography; never invent person IDs.",
    inputSchema: z.object({
        query: z.string().min(1),
        page: z.number().int().min(1).max(500).optional(),
        limit: z.number().int().min(1).max(20).optional(),
    }),
    execute: async ({ query, page = 1, limit = 8 }, { abortSignal }) => {
        try {
            const data = await searchTMDBPeople(query, abortSignal, page);
            return { success: true, source: "TMDB", ...data, results: data.results.slice(0, limit), count: Math.min(data.results.length, limit) };
        } catch (error) {
            abortSignal?.throwIfAborted();
            return { success: false, error: error instanceof Error ? error.message : "TMDB people search failed.", results: [] };
        }
    },
});

export const getPersonDetails = tool({
    description: "Get a person's biography, birth date, birthplace, aliases, and known department directly from TMDB. Use the numeric person ID returned by searchPeople or movie/show credits.",
    inputSchema: z.object({ personId: z.number().int().positive() }),
    execute: async ({ personId }, { abortSignal }) => {
        try {
            return { success: true, source: "TMDB", person: await getTMDBPerson(personId, abortSignal) };
        } catch (error) {
            abortSignal?.throwIfAborted();
            return { success: false, error: error instanceof Error ? error.message : "TMDB person lookup failed." };
        }
    },
});

export const navigateToPerson = tool({
    description: "Open a person's profile in Navigator. Use a numeric TMDB person ID from the viewed profile, people search, person details, or title credits.",
    inputSchema: z.object({ personId: z.number().int().positive() }),
    execute: async ({ personId }, { abortSignal }) => {
        try {
            const person = await getTMDBPerson(personId, abortSignal);
            return {
                success: true, action: "navigate", personId: person.id, url: `/person/${person.id}`,
                mediaName: person.name, mediaType: "Person", poster: person.poster,
            };
        } catch (error) {
            abortSignal?.throwIfAborted();
            return { success: false, error: error instanceof Error ? error.message : "Person profile could not be opened." };
        }
    },
});

export const getFilmography = tool({
    description: "Get a person's movie and TV credits directly from TMDB. Filter by acting, directing, writing, or producing to answer questions such as 'movies directed by Nolan'. Results are deduplicated by title and include roles and characters. Use pagination to see further credits; do not claim the first page is a complete filmography.",
    inputSchema: z.object({
        personId: z.number().int().positive(),
        mediaType: z.enum(["Movie", "Series"]).optional(),
        role: z.enum(["all", "acting", "directing", "writing", "producing"]).optional(),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(40).optional(),
    }),
    execute: async ({ personId, mediaType, role, page, limit }, { abortSignal }) => {
        try {
            const data = await getTMDBFilmography(personId, {
                mediaType: mediaType === "Movie" ? "movie" : mediaType === "Series" ? "series" : undefined,
                role, page, limit,
            }, abortSignal);
            return { success: true, source: "TMDB", personId, ...data, count: data.results.length };
        } catch (error) {
            abortSignal?.throwIfAborted();
            return { success: false, error: error instanceof Error ? error.message : "TMDB filmography lookup failed.", results: [] };
        }
    },
});
