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
import { LibraryApi } from "@jellyfin/sdk/lib/generated-client/api/library-api";
import { getItemsApi } from "@jellyfin/sdk/lib/utils/api/items-api";
import { getTvShowsApi } from "@jellyfin/sdk/lib/utils/api/tv-shows-api";
import { getLibraryApi } from "@jellyfin/sdk/lib/utils/api/library-api";
import { getGenresApi } from "@jellyfin/sdk/lib/utils/api/genres-api";
import { createJellyfinInstance } from "@/lib/utils";

// Type aliases for easier use
type JellyfinItem = BaseItemDto;

// Media segment types
export interface MediaSegment {
  Id: string;
  ItemId: string;
  Type: "Intro" | "Outro";
  StartTicks: number;
  EndTicks: number;
}

interface MediaSegmentsResponse {
  Items: MediaSegment[];
  TotalRecordCount: number;
  StartIndex: number;
}

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

export async function fetchMovies(
  limit: number = 20,
  genreIds?: string[]
): Promise<JellyfinItem[]> {
  try {
    const { serverUrl, user } = await getAuthData();
    const jellyfinInstance = createJellyfinInstance();
    const api = jellyfinInstance.createApi(serverUrl);
    api.accessToken = user.AccessToken;


    const { data } = await getItemsApi(api).getItems({
      userId: user.Id,
      includeItemTypes: [BaseItemKind.Movie],
      recursive: true,
      sortBy: [ItemSortBy.DateCreated],
      sortOrder: [SortOrder.Descending],
      limit,
      genreIds,
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

      const authError = new Error(
        "Authentication expired. Please sign in again."
      );
      (authError as any).isAuthError = true;
      throw authError;
    }

    return [];
  }
}

export async function fetchTVShows(
  limit: number = 20,
  genreIds?: string[]
): Promise<JellyfinItem[]> {
  try {
    const { serverUrl, user } = await getAuthData();
    const jellyfinInstance = createJellyfinInstance();
    const api = jellyfinInstance.createApi(serverUrl);
    api.accessToken = user.AccessToken;

    const { data } = await getItemsApi(api).getItems({
      userId: user.Id,
      includeItemTypes: [BaseItemKind.Series],
      recursive: true,
      sortBy: [ItemSortBy.DateCreated],
      sortOrder: [SortOrder.Descending],
      limit,
      genreIds,
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
    const jellyfinInstance = createJellyfinInstance();
    const api = jellyfinInstance.createApi(serverUrl);
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

      const authError = new Error(
        "Authentication expired. Please sign in again."
      );
      (authError as any).isAuthError = true;
      throw authError;
    }

    return null;
  }
}

export async function fetchPersonDetails(
  personId: string
): Promise<JellyfinItem | null> {
  try {
    const { serverUrl, user } = await getAuthData();
    const jellyfinInstance = createJellyfinInstance();
    const api = jellyfinInstance.createApi(serverUrl);
    api.accessToken = user.AccessToken;

    const userLibraryApi = new UserLibraryApi(api.configuration);
    const { data } = await userLibraryApi.getItem({
      userId: user.Id,
      itemId: personId,
    });
    return data;
  } catch (error) {
    console.error("Failed to fetch person details:", error);

    // If it's an authentication error, throw an error with a special flag
    if (isAuthError(error)) {

      const authError = new Error(
        "Authentication expired. Please sign in again."
      );
      (authError as any).isAuthError = true;
      throw authError;
    }

    return null;
  }
}

export async function fetchPersonFilmography(
  personId: string
): Promise<JellyfinItem[]> {
  try {
    const { serverUrl, user } = await getAuthData();
    const jellyfinInstance = createJellyfinInstance();
    const api = jellyfinInstance.createApi(serverUrl);
    api.accessToken = user.AccessToken;

    const { data } = await getItemsApi(api).getItems({
      userId: user.Id,
      includeItemTypes: [BaseItemKind.Movie, BaseItemKind.Series],
      recursive: true,
      personIds: [personId],
      sortBy: [ItemSortBy.ProductionYear],
      sortOrder: [SortOrder.Descending],
      fields: [
        ItemFields.CanDelete,
        ItemFields.PrimaryImageAspectRatio,
        ItemFields.Overview,
        ItemFields.People,
      ],
    });
    return data.Items || [];
  } catch (error) {
    console.error("Failed to fetch person filmography:", error);

    // If it's an authentication error, throw an error with a special flag
    if (isAuthError(error)) {

      const authError = new Error(
        "Authentication expired. Please sign in again."
      );
      (authError as any).isAuthError = true;
      throw authError;
    }

    return [];
  }
}

export async function fetchResumeItems() {
  try {
    const { serverUrl, user } = await getAuthData();
    const jellyfinInstance = createJellyfinInstance();
    const api = jellyfinInstance.createApi(serverUrl);

    api.accessToken = user.AccessToken;

    const itemsApi = getItemsApi(api);

    const { data } = await itemsApi.getResumeItems({
      userId: user.Id,
      fields: [
        ItemFields.CanDelete,
        ItemFields.PrimaryImageAspectRatio,
        ItemFields.Overview,
      ],
      enableImages: true,
    });
    return data.Items || [];
  } catch (error) {
    console.error("Failed to fetch resume items:", error);
    return [];
  }
}

export async function fetchNextUpItems() {
  try {
    const { serverUrl, user } = await getAuthData();
    const jellyfinInstance = createJellyfinInstance();
    const api = jellyfinInstance.createApi(serverUrl);
    api.accessToken = user.AccessToken;

    const tvShowsApi = getTvShowsApi(api);
    const { data } = await tvShowsApi.getNextUp({
      userId: user.Id,
      fields: [
        ItemFields.CanDelete,
        ItemFields.PrimaryImageAspectRatio,
        ItemFields.Overview,
      ],
      enableImages: true
    });

    return data.Items || [];
  } catch (error) {
    console.error("Failed to fetch next up episodes:", error);
    return [];
  }
}

// Progress tracking functions
export async function reportPlaybackStart(
  itemId: string,
  mediaSourceId: string,
  playSessionId: string
): Promise<boolean> {
  try {
    const { serverUrl, user } = await getAuthData();
    const jellyfinInstance = createJellyfinInstance();
    const api = jellyfinInstance.createApi(serverUrl);
    api.accessToken = user.AccessToken;

    const response = await fetch(`${serverUrl}/Sessions/Playing`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `MediaBrowser Token="${user.AccessToken}"`,
      },
      body: JSON.stringify({
        ItemId: itemId,
        MediaSourceId: mediaSourceId,
        PlaySessionId: playSessionId,
        CanSeek: true,
        QueueableMediaTypes: ["Video", "Audio"],
        PlayMethod: "Transcode",
      }),
    });

    return response.ok;
  } catch (error) {
    console.error("Failed to report playback start:", error);
    return false;
  }
}

export async function reportPlaybackProgress(
  itemId: string,
  mediaSourceId: string,
  playSessionId: string,
  positionTicks: number,
  isPaused: boolean = false
): Promise<boolean> {
  try {
    const { serverUrl, user } = await getAuthData();
    const jellyfinInstance = createJellyfinInstance();
    const api = jellyfinInstance.createApi(serverUrl);
    api.accessToken = user.AccessToken;

    const response = await fetch(`${serverUrl}/Sessions/Playing/Progress`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `MediaBrowser Token="${user.AccessToken}"`,
      },
      body: JSON.stringify({
        ItemId: itemId,
        MediaSourceId: mediaSourceId,
        PlaySessionId: playSessionId,
        PositionTicks: positionTicks,
        IsPaused: isPaused,
        PlayMethod: "Transcode",
      }),
    });

    return response.ok;
  } catch (error) {
    console.error("Failed to report playback progress:", error);
    return false;
  }
}

export async function reportPlaybackStopped(
  itemId: string,
  mediaSourceId: string,
  playSessionId: string,
  positionTicks: number
): Promise<boolean> {
  try {
    const { serverUrl, user } = await getAuthData();
    const jellyfinInstance = createJellyfinInstance();
    const api = jellyfinInstance.createApi(serverUrl);
    api.accessToken = user.AccessToken;

    const response = await fetch(`${serverUrl}/Sessions/Playing/Stopped`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `MediaBrowser Token="${user.AccessToken}"`,
      },
      body: JSON.stringify({
        ItemId: itemId,
        MediaSourceId: mediaSourceId,
        PlaySessionId: playSessionId,
        PositionTicks: positionTicks,
        PlayMethod: "Transcode",
      }),
    });

    return response.ok;
  } catch (error) {
    console.error("Failed to report playback stopped:", error);
    return false;
  }
}

export async function fetchLibraryItems(
  libraryId: string,
  limit: number = 50,
  startIndex: number = 0
): Promise<{ items: JellyfinItem[]; totalRecordCount: number }> {
  try {
    const { serverUrl, user } = await getAuthData();
    const jellyfinInstance = createJellyfinInstance();
    const api = jellyfinInstance.createApi(serverUrl);
    api.accessToken = user.AccessToken;

    const { data } = await getItemsApi(api).getItems({
      userId: user.Id,
      parentId: libraryId,
      includeItemTypes: [BaseItemKind.Movie, BaseItemKind.Series],
      recursive: true,
      sortBy: [ItemSortBy.SortName],
      sortOrder: [SortOrder.Ascending],
      limit,
      startIndex,
      fields: [
        ItemFields.CanDelete,
        ItemFields.PrimaryImageAspectRatio,
        ItemFields.Overview,
        ItemFields.DateCreated,
      ],
    });

    return {
      items: data.Items || [],
      totalRecordCount: data.TotalRecordCount || 0,
    };
  } catch (error) {
    console.error("Failed to fetch library items:", error);

    // If it's an authentication error, throw an error with a special flag
    if (isAuthError(error)) {

      const authError = new Error(
        "Authentication expired. Please sign in again."
      );
      (authError as any).isAuthError = true;
      throw authError;
    }

    return { items: [], totalRecordCount: 0 };
  }
}

export async function fetchSimilarItems(itemId: string, limit: number = 12) {
  try {
    const { serverUrl, user } = await getAuthData();
    const jellyfinInstance = createJellyfinInstance();
    const api = jellyfinInstance.createApi(serverUrl);
    api.accessToken = user.AccessToken;

    const { data } = await getLibraryApi(api).getSimilarItems({
      itemId: itemId,
      userId: user.Id,
      limit,
    });


    return data.Items || [];
  } catch (error) {
    console.error("Failed to fetch library items:", error);

    // If it's an authentication error, throw an error with a special flag
    if (isAuthError(error)) {

      const authError = new Error(
        "Authentication expired. Please sign in again."
      );
      (authError as any).isAuthError = true;
      throw authError;
    }

    return [];
  }
}

export async function fetchIntroOutro(
  itemId: string
): Promise<MediaSegmentsResponse | null> {
  try {
    const { serverUrl, user } = await getAuthData();
    const jellyfinInstance = createJellyfinInstance();
    const api = jellyfinInstance.createApi(serverUrl);
    api.accessToken = user.AccessToken;

    const response = await fetch(
      `${serverUrl}/MediaSegments/${itemId}?includeSegmentTypes=Outro&includeSegmentTypes=Intro`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `MediaBrowser Token="${user.AccessToken}"`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to fetch intro/outro segments:", error);

    // If it's an authentication error, throw an error with a special flag
    if (isAuthError(error)) {

      const authError = new Error(
        "Authentication expired. Please sign in again."
      );
      (authError as any).isAuthError = true;
      throw authError;
    }

    return null;
  }
}

export async function scanLibrary(libraryId?: string): Promise<void> {
  try {
    const { serverUrl, user } = await getAuthData();

    let url = `${serverUrl}/Library/Refresh`;

    // If libraryId is provided, scan only that specific library
    if (libraryId) {
      url = `${serverUrl}/Items/${libraryId}/Refresh`;
    }

    // Use direct API call to trigger library scan
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `MediaBrowser Token="${user.AccessToken}"`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
  } catch (error) {
    console.error("Failed to scan library:", error);

    if (isAuthError(error)) {

      const authError = new Error(
        "Authentication expired. Please sign in again."
      );
      (authError as any).isAuthError = true;
      throw authError;
    }

    throw new Error("Failed to scan library");
  }
}

export async function fetchGenres() {
  try {
    const { serverUrl, user } = await getAuthData();
    const jellyfinInstance = createJellyfinInstance();
    const api = jellyfinInstance.createApi(serverUrl);
    api.accessToken = user.AccessToken;

    const { data } = await getGenresApi(api).getGenres({
      userId: user.Id,
    });
    return data;
  } catch (error) {
    console.error("Failed to fetch genres:", error);

    // If it's an authentication error, throw an error with a special flag
    if (isAuthError(error)) {

      const authError = new Error(
        "Authentication expired. Please sign in again."
      );
      (authError as any).isAuthError = true;
      throw authError;
    }

    return { Items: [], TotalRecordCount: 0, StartIndex: 0 };
  }
}

export async function fetchGenre(genreName: string) {
  try {
    const { serverUrl, user } = await getAuthData();
    const jellyfinInstance = createJellyfinInstance();
    const api = jellyfinInstance.createApi(serverUrl);
    api.accessToken = user.AccessToken;

    const { data } = await getGenresApi(api).getGenre({
      userId: user.Id,
      genreName: genreName,
    });
    return data;
  } catch (error) {
    console.error("Failed to fetch genres:", error);

    // If it's an authentication error, throw an error with a special flag
    if (isAuthError(error)) {

      const authError = new Error(
        "Authentication expired. Please sign in again."
      );
      (authError as any).isAuthError = true;
      throw authError;
    }

    return { Items: [], TotalRecordCount: 0, StartIndex: 0 };
  }
}
