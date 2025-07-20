"use server";

import { cookies } from "next/headers";
import { Jellyfin } from "@jellyfin/sdk";
import { Api } from "@jellyfin/sdk/lib/api";
import { ItemsApi } from "@jellyfin/sdk/lib/generated-client/api/items-api";
import { BaseItemDto } from "@jellyfin/sdk/lib/generated-client/models/base-item-dto";
import { BaseItemKind } from "@jellyfin/sdk/lib/generated-client/models/base-item-kind";
import { ItemFields } from "@jellyfin/sdk/lib/generated-client/models/item-fields";
import { ItemSortBy } from "@jellyfin/sdk/lib/generated-client/models/item-sort-by";
import { SortOrder } from "@jellyfin/sdk/lib/generated-client/models/sort-order";
import { UserLibraryApi } from "@jellyfin/sdk/lib/generated-client/api/user-library-api";
import { getItemsApi } from "@jellyfin/sdk/lib/utils/api/items-api";
import { MoviesApi } from "@jellyfin/sdk/lib/generated-client/api/movies-api";
import { CollectionsApi } from "@jellyfin/sdk/lib/generated-client/api/collections-api";

// Type aliases for easier use
type JellyfinItem = BaseItemDto;

// Create global Jellyfin SDK instance
const jellyfin = new Jellyfin({
  clientInfo: {
    name: "Finetic",
    version: "1.0.0",
  },
  deviceInfo: {
    name: "Finetic Web Client",
    id: "finetic-web-client",
  },
});

// Helper function to get auth data from cookies
async function getAuthData() {
  const cookieStore = await cookies();
  const authData = cookieStore.get("jellyfin-auth");

  if (!authData?.value) {
    throw new Error("Not authenticated");
  }

  const parsed = JSON.parse(authData.value);
  return { serverUrl: parsed.serverUrl, user: parsed.user };
}

// Helper function to check if an error is authentication-related
function isAuthError(error: any): boolean {
  return (
    error?.response?.status === 401 ||
    error?.response?.status === 403 ||
    error?.status === 401 ||
    error?.status === 403
  );
}

// Server Action to clear invalid auth data
export async function clearAuthData() {
  const cookieStore = await cookies();
  cookieStore.delete("jellyfin-auth");
  cookieStore.delete("jellyfin-server-url");
}

export async function fetchMovies(limit: number = 20): Promise<JellyfinItem[]> {
  try {
    const { serverUrl, user } = await getAuthData();
    const api = jellyfin.createApi(serverUrl);
    api.accessToken = user.AccessToken;

    console.log(serverUrl, api.accessToken, user.Id);

    const { data } = await getItemsApi(api).getItems({
      userId: user.Id,
      includeItemTypes: [BaseItemKind.Movie],
      recursive: true,
      sortBy: [ItemSortBy.DateCreated],
      sortOrder: [SortOrder.Descending],
      limit,
      fields: [
        ItemFields.CanDelete,
        ItemFields.PrimaryImageAspectRatio,
        ItemFields.Overview,
      ],
    });
    return data.Items || [];
  } catch (error) {
    console.error("Failed to fetch movies:", error);

    // If it's an authentication error, throw an error with a special flag
    if (isAuthError(error)) {
      console.log("Authentication error detected, clearing auth data");
      const authError = new Error(
        "Authentication expired. Please sign in again."
      );
      (authError as any).isAuthError = true;
      throw authError;
    }

    return [];
  }
}

export async function fetchPersonDetails(
    personId: string
    ): Promise<JellyfinItem | null> {
    try {
        const { serverUrl, user } = await getAuthData();
        const api = jellyfin.createApi(serverUrl);
        api.accessToken = user.AccessToken;

        const peopleApi = new PeopleApi(api.configuration);
        const { data } = await peopleApi.getPerson({
            personId: personId,
            userId: user.Id,
        });
        return data;
    } catch (error) {
        console.error("Failed to fetch person details:", error);
        return null;
    }
}

export async function fetchCollection(
    collectionId: string
    ): Promise<JellyfinItem | null> {
    try {
        const { serverUrl, user } = await getAuthData();
        const api = jellyfin.createApi(serverUrl);
        api.accessToken = user.AccessToken;

        const collectionsApi = new CollectionsApi(api.configuration);
        const { data } = await collectionsApi.getCollection({
            collectionId: collectionId,
            userId: user.Id,
        });
        return data;
    } catch (error) {
        console.error("Failed to fetch collection details:", error);
        return null;
    }
}

export async function fetchRecommendations(
  limit: number = 20
): Promise<JellyfinItem[]> {
  try {
    const { serverUrl, user } = await getAuthData();
    const api = jellyfin.createApi(serverUrl);
    api.accessToken = user.AccessToken;

    const moviesApi = new MoviesApi(api.configuration);

    const { data } = await moviesApi.getMovieRecommendations({
      userId: user.Id,
      limit,
      fields: [
        ItemFields.CanDelete,
        ItemFields.PrimaryImageAspectRatio,
        ItemFields.Overview,
      ],
    });
    return data.Items || [];
  } catch (error) {
    console.error("Failed to fetch recommendations:", error);
    return [];
  }
}

export async function fetchTVShows(
  limit: number = 20
): Promise<JellyfinItem[]> {
  try {
    const { serverUrl, user } = await getAuthData();
    const api = jellyfin.createApi(serverUrl);
    api.accessToken = user.AccessToken;

    const { data } = await getItemsApi(api).getItems({
      userId: user.Id,
      includeItemTypes: [BaseItemKind.Series],
      recursive: true,
      sortBy: [ItemSortBy.DateCreated],
      sortOrder: [SortOrder.Descending],
      limit,
      fields: [
        ItemFields.CanDelete,
        ItemFields.PrimaryImageAspectRatio,
        ItemFields.Overview,
      ],
    });
    return data.Items || [];
  } catch (error) {
    console.error("Failed to fetch TV shows:", error);

    // If it's an authentication error, throw an error with a special flag
    if (isAuthError(error)) {
      console.log("Authentication error detected, clearing auth data");
      const authError = new Error(
        "Authentication expired. Please sign in again."
      );
      (authError as any).isAuthError = true;
      throw authError;
    }

    return [];
  }
}

export async function fetchMediaDetails(
  mediaItemId: string
): Promise<JellyfinItem | null> {
  try {
    const { serverUrl, user } = await getAuthData();
    const api = jellyfin.createApi(serverUrl);
    api.accessToken = user.AccessToken;

    const userLibraryApi = new UserLibraryApi(api.configuration);
    const { data } = await userLibraryApi.getItem({
      userId: user.Id,
      itemId: mediaItemId,
    });
    return data;
  } catch (error) {
    console.error("Failed to fetch media details:", error);

    // If it's an authentication error, throw an error with a special flag
    if (isAuthError(error)) {
      console.log("Authentication error detected, clearing auth data");
      const authError = new Error(
        "Authentication expired. Please sign in again."
      );
      (authError as any).isAuthError = true;
      throw authError;
    }

    return null;
  }
}

export async function fetchResumeItems() {
  try {
    const { serverUrl, user } = await getAuthData();
    const api = jellyfin.createApi(serverUrl);

    api.accessToken = user.AccessToken;

    const itemsApi = getItemsApi(api);

    const { data } = await itemsApi.getResumeItems({
      userId: user.Id,
      fields: [
        ItemFields.CanDelete,
        ItemFields.PrimaryImageAspectRatio,
        ItemFields.Overview,
      ],
    });
    return data.Items || [];
  } catch (error) {
    console.error("Failed to fetch resume items:", error);
    return [];
  }
}
