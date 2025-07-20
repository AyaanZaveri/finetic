import { google } from "@ai-sdk/google";
import { convertToCoreMessages, streamText, tool } from "ai";
import { z } from "zod";
import { searchItems, searchPeople } from "@/app/actions/search";
import {
  fetchMovies,
  fetchTVShows,
  fetchMediaDetails,
  fetchResumeItems,
  fetchRecommendations,
  fetchPersonDetails,
  fetchCollection,
} from "@/app/actions/media";

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    const result = await streamText({
      model: google("gemini-2.0-flash"),
      messages: convertToCoreMessages(messages),
      maxSteps: 5,
      tools: {
        searchMedia: tool({
          description:
            "Search for movies, TV shows, or episodes by name or keyword",
          parameters: z.object({
            query: z
              .string()
              .describe("The search term or media title to look for"),
          }),
          execute: async ({ query }) => {
            console.log("🔍 [searchMedia] Tool called with query:", query);
            try {
              const results = await searchItems(query);
              return {
                success: true,
                results: results.map((item) => ({
                  id: item.Id,
                  name: item.Name,
                  type: item.Type, // Movie, Series, Episode
                  year: item.ProductionYear,
                  overview: item.Overview,
                })),
                count: results.length,
              };
            } catch (error) {
              return {
                success: false,
                error: "Failed to search media",
                results: [],
              };
            }
          },
        }),

        navigateToMedia: tool({
          description: "Navigate to a specific movie, TV show, or episode page",
          parameters: z.object({
            mediaId: z.string().describe("The unique ID of the media item"),
            mediaType: z
              .enum(["Movie", "Series", "Episode"])
              .describe(
                "The type of media - Movie, Series (TV Show), or Episode"
              ),
          }),
          execute: async ({ mediaId, mediaType }) => {
            console.log("🎯 [navigateToMedia] Tool called with:", {
              mediaId,
              mediaType,
            });
            let basePath: string;
            if (mediaType === "Movie") {
              basePath = "/movie";
            } else if (mediaType === "Series") {
              basePath = "/show";
            } else {
              basePath = "/episode";
            }
            const url = `${basePath}/${mediaId}`;
            return {
              success: true,
              action: "navigate",
              url,
              message: `Navigating to ${mediaType.toLowerCase()}...`,
            };
          },
        }),

        getMovies: tool({
          description: "Get a list of recent movies from the library",
          parameters: z.object({
            limit: z
              .number()
              .optional()
              .describe("Number of movies to retrieve (default: 20)"),
          }),
          execute: async ({ limit = 20 }) => {
            console.log("🎬 [getMovies] Tool called with limit:", limit);
            try {
              const movies = await fetchMovies(limit);
              return {
                success: true,
                movies: movies.map((movie) => ({
                  id: movie.Id,
                  name: movie.Name,
                  year: movie.ProductionYear,
                  overview: movie.Overview?.substring(0, 200) + "...",
                })),
                count: movies.length,
              };
            } catch (error) {
              return {
                success: false,
                error: "Failed to fetch movies",
                movies: [],
              };
            }
          },
        }),

        getTVShows: tool({
          description: "Get a list of recent TV shows from the library",
          parameters: z.object({
            limit: z
              .number()
              .optional()
              .describe("Number of TV shows to retrieve (default: 20)"),
          }),
          execute: async ({ limit = 20 }) => {
            console.log("📺 [getTVShows] Tool called with limit:", limit);
            try {
              const shows = await fetchTVShows(limit);
              return {
                success: true,
                shows: shows.map((show) => ({
                  id: show.Id,
                  name: show.Name,
                  year: show.ProductionYear,
                  overview: show.Overview?.substring(0, 200) + "...",
                })),
                count: shows.length,
              };
            } catch (error) {
              return {
                success: false,
                error: "Failed to fetch TV shows",
                shows: [],
              };
            }
          },
        }),

        getMediaDetails: tool({
          description:
            "Get detailed information about a specific movie or TV show",
          parameters: z.object({
            mediaId: z.string().describe("The unique ID of the media item"),
          }),
          execute: async ({ mediaId }) => {
            console.log(
              "📋 [getMediaDetails] Tool called with mediaId:",
              mediaId
            );
            try {
              const details = await fetchMediaDetails(mediaId);
              if (!details) {
                return {
                  success: false,
                  error: "Media not found",
                };
              }
              return {
                success: true,
                details: {
                  id: details.Id,
                  name: details.Name,
                  type: details.Type,
                  year: details.ProductionYear,
                  overview: details.Overview,
                  rating: details.OfficialRating,
                  runtime: details.RunTimeTicks
                    ? Math.round(details.RunTimeTicks / 600000000)
                    : null,
                  genres: details.Genres,
                  cast: details.People?.filter((p) => p.Type === "Actor")
                    .slice(0, 5)
                    .map((p) => p.Name),
                },
              };
            } catch (error) {
              return {
                success: false,
                error: "Failed to fetch media details",
              };
            }
          },
        }),

        getResumeItems: tool({
          description: "Get the list of items to continue watching.",
          parameters: z.object({}),
          execute: async () => {
            console.log("▶️ [getResumeItems] Tool called");
            try {
              const items = await fetchResumeItems();
              return {
                success: true,
                items: items.map((item) => ({
                  id: item.Id,
                  name: item.Name,
                  type: item.Type,
                  year: item.ProductionYear,
                })),
                count: items.length,
              };
            } catch (error) {
              return {
                success: false,
                error: "Failed to fetch resume items",
                items: [],
              };
            }
          },
        }),

        getRecommendations: tool({
          description: "Get movie recommendations.",
          parameters: z.object({
            limit: z.number().optional().describe("Number of recommendations to retrieve (default: 20)"),
          }),
          execute: async ({ limit = 20 }) => {
            console.log("👍 [getRecommendations] Tool called with limit:", limit);
            try {
              const items = await fetchRecommendations(limit);
              return {
                success: true,
                items: items.map((item) => ({
                  id: item.Id,
                  name: item.Name,
                  type: item.Type,
                  year: item.ProductionYear,
                })),
                count: items.length,
              };
            } catch (error) {
              return {
                success: false,
                error: "Failed to fetch recommendations",
                items: [],
              };
            }
          },
        }),

        searchPeople: tool({
          description: "Search for people (actors, directors, etc.).",
          parameters: z.object({
            query: z.string().describe("The name of the person to search for"),
          }),
          execute: async ({ query }) => {
            console.log("🧑 [searchPeople] Tool called with query:", query);
            try {
              const people = await searchPeople(query);
              return {
                success: true,
                people: people.map((person) => ({
                  id: person.Id,
                  name: person.Name,
                })),
                count: people.length,
              };
            } catch (error) {
              return {
                success: false,
                error: "Failed to search people",
                people: [],
              };
            }
          },
        }),

        getPersonDetails: tool({
          description: "Get detailed information about a specific person.",
          parameters: z.object({
            personId: z.string().describe("The unique ID of the person"),
          }),
          execute: async ({ personId }) => {
            console.log(
              "🧑 [getPersonDetails] Tool called with personId:",
              personId
            );
            try {
              const details = await fetchPersonDetails(personId);
              if (!details) {
                return {
                  success: false,
                  error: "Person not found",
                };
              }
              return {
                success: true,
                details: {
                  id: details.Id,
                  name: details.Name,
                  overview: details.Overview,
                },
              };
            } catch (error) {
              return {
                success: false,
                error: "Failed to fetch person details",
              };
            }
          },
        }),

        getCollection: tool({
          description: "Get a collection of media items.",
          parameters: z.object({
            collectionId: z
              .string()
              .describe("The unique ID of the collection"),
          }),
          execute: async ({ collectionId }) => {
            console.log(
              "📚 [getCollection] Tool called with collectionId:",
              collectionId
            );
            try {
              const collection = await fetchCollection(collectionId);
              if (!collection) {
                return {
                  success: false,
                  error: "Collection not found",
                };
              }
              return {
                success: true,
                collection: {
                  id: collection.Id,
                  name: collection.Name,
                  overview: collection.Overview,
                },
              };
            } catch (error) {
              return {
                success: false,
                error: "Failed to fetch collection",
              };
            }
          },
        }),
      },
      system: `You are Finetic, an AI assistant for a media library application (similar to Plex/Jellyfin). 
      Help users navigate to movies and TV shows, search for content, and provide information about media.

      SEARCH CORRECTION: Before searching, automatically correct common abbreviations and shorthand terms to their full proper names:
      - "b99" → "Brooklyn Nine-Nine"
      - "dune 2" → "Dune: Part Two"
      - "got" → "Game of Thrones"
      - "lotr" → "The Lord of the Rings"
      - "hp" (when referring to movies/shows) → "Harry Potter"
      - "sw" → "Star Wars"
      - "mcu" → "Marvel Cinematic Universe"
      - "dc" → "DC Comics" or "DC Universe"
      - "twd" → "The Walking Dead"
      - "bb" → "Breaking Bad"
      - "bcs" → "Better Call Saul"
      - "st" → "Star Trek" or "Stranger Things" (use context)
      - "jw" → "Jurassic World"
      - "jp" → "Jurassic Park"
      - "f&f" or "ff" → "Fast & Furious"
      - "mib" → "Men in Black"
      - "x-men" variants → "X-Men"
      - "avengers" variants → "The Avengers"
      - "spider-man" variants → "Spider-Man"
      - "batman" variants → "Batman"
      - "superman" variants → "Superman"
      
      Always expand abbreviated titles and use the most complete, official title when searching. If unsure about an abbreviation, try both the abbreviated and expanded versions.

      VAGUE QUERY HANDLING: When users provide vague descriptions instead of exact titles, use contextual clues to identify the likely movie/show:
      - "the movie with the tars robot" → "Interstellar"
      - "the movie with the blue people" → "Avatar"
      - "the movie where they go back to the future" → "Back to the Future"
      - "the show about meth" → "Breaking Bad"
      - "the wizard movie" or "the boy wizard" → "Harry Potter"
      - "the ring movie" → "The Lord of the Rings"
      - "the space movie with lightsabers" → "Star Wars"
      - "the superhero team movie" → "The Avengers"
      - "the dinosaur movie" → "Jurassic Park"
      - "the shark movie" → "Jaws"
      - "the robot movie" → could be "Terminator", "I, Robot", "Wall-E" etc. (use additional context)
      - "the alien movie" → could be "Alien", "E.T.", "Independence Day" etc. (use additional context)
      - "the vampire movie" → could be "Twilight", "Interview with the Vampire", etc.
      - "the zombie show" → "The Walking Dead"
      - "the office show" → "The Office"
      - "the friends show" → "Friends"
      
      Use character names, plot elements, memorable quotes, distinctive features, or other descriptive elements to identify content. If multiple possibilities exist, search for the most popular/well-known option first, then offer alternatives if needed.

      When users ask to "go to", "navigate to", "open", or "show me" a specific movie or TV show:
      1. First correct/expand any abbreviations in the user's query
      2. Search for the media using searchMedia with the corrected query
      3. If found, use navigateToMedia to provide the navigation URL
      4. Be helpful and conversational

      When you use the navigateToMedia tool, make sure to mention that you're navigating to the content by name only, without including the URL.`,
      onFinish: async ({ usage, finishReason, text, toolResults }) => {
        // Handle navigation logic here if needed
        console.log("Chat finished:", {
          usage,
          finishReason,
          toolResultsCount: toolResults?.length,
        });
      },
    });

    return result.toDataStreamResponse();
  } catch (error) {
    console.error("Chat API Error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
