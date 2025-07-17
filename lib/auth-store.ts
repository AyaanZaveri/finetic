import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Jellyfin } from "@jellyfin/sdk";
import { Api } from "@jellyfin/sdk/lib/api";
import { SystemApi } from "@jellyfin/sdk/lib/generated-client/api/system-api";
import { ItemsApi } from "@jellyfin/sdk/lib/generated-client/api/items-api";
import { UserLibraryApi } from "@jellyfin/sdk/lib/generated-client/api/user-library-api";
import { Configuration } from "@jellyfin/sdk/lib/generated-client/configuration";
import { BaseItemDto } from "@jellyfin/sdk/lib/generated-client/models/base-item-dto";
import { UserDto } from "@jellyfin/sdk/lib/generated-client/models/user-dto";
import { BaseItemKind } from "@jellyfin/sdk/lib/generated-client/models/base-item-kind";
import { ItemFields } from "@jellyfin/sdk/lib/generated-client/models/item-fields";
import { ItemSortBy } from "@jellyfin/sdk/lib/generated-client/models/item-sort-by";
import { SortOrder } from "@jellyfin/sdk/lib/generated-client/models/sort-order";

// Type aliases for easier use
type JellyfinItem = BaseItemDto;
type JellyfinUserWithToken = UserDto & { AccessToken?: string };

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

interface AuthState {
  serverUrl: string | null;
  user: JellyfinUserWithToken | null;
  api: Api | null;
  isAuthenticated: boolean;
  setServerUrl: (url: string) => void;
  setUser: (user: JellyfinUserWithToken) => void;
  logout: () => void;
  checkServerHealth: (url: string) => Promise<boolean>;
  authenticateUser: (username: string, password: string) => Promise<boolean>;
  fetchMovies: (limit?: number) => Promise<JellyfinItem[]>;
  fetchTVShows: (limit?: number) => Promise<JellyfinItem[]>;
  searchItems: (query: string) => Promise<JellyfinItem[]>;
  fetchMovieDetails: (movieId: string) => Promise<JellyfinItem | null>;
  fetchTVShowDetails: (tvShowId: string) => Promise<JellyfinItem | null>;
  fetchSeasons: (tvShowId: string) => Promise<JellyfinItem[]>;
  fetchEpisodes: (seasonId: string) => Promise<JellyfinItem[]>;
  getImageUrl: (itemId: string, imageType?: string, tag?: string) => string;
  getDownloadUrl: (itemId: string, mediaSourceId: string) => string;
  getStreamUrl: (
    itemId: string,
    mediaSourceId: string,
    quality?: string
  ) => string;
  getSubtitleTracks: (itemId: string, mediaSourceId: string) => Promise<Array<{kind: string, label: string, language: string, src: string, default?: boolean}>>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      serverUrl: null,
      user: null,
      api: null,
      isAuthenticated: false,

      setServerUrl: (url: string) => {
        set({ serverUrl: url });
      },

      setUser: (user: JellyfinUserWithToken) => {
        const { serverUrl } = get();
        let api = null;
        if (serverUrl) {
          api = jellyfin.createApi(serverUrl);
        }
        set({ user, api, isAuthenticated: true });
      },

      logout: () => {
        set({ user: null, api: null, isAuthenticated: false, serverUrl: null });
      },

      checkServerHealth: async (url: string): Promise<boolean> => {
        try {
          // Create a SystemApi instance
          const systemApi = new SystemApi(new Configuration({ basePath: url }));
          // Check server information
          const { data } = await systemApi.getPublicSystemInfo();
          return Boolean(data.ServerName);
        } catch (error) {
          console.error("Server health check failed:", error);
          return false;
        }
      },

      authenticateUser: async (
        username: string,
        password: string
      ): Promise<boolean> => {
        const { serverUrl } = get();
        if (!serverUrl) return false;

        try {
          // Create Api instance using SDK
          const api = jellyfin.createApi(serverUrl);
          const { data: result } = await api.authenticateUserByName(
            username,
            password
          );

          if (result.AccessToken) {
            set({
              user: { ...result.User, AccessToken: result.AccessToken },
              api,
              isAuthenticated: true,
            });
            return true;
          }
        } catch (error) {
          console.error("Authentication failed", error);
        }
        return false;
      },

      fetchMovies: async (limit: number = 20): Promise<JellyfinItem[]> => {
        const { api, user } = get();
        if (!api || !user) return [];

        try {
          const itemsApi = new ItemsApi(api.configuration);
          const { data } = await itemsApi.getItems({
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
          return [];
        }
      },

      fetchTVShows: async (limit: number = 20): Promise<JellyfinItem[]> => {
        const { api, user } = get();
        if (!api || !user) return [];

        try {
          const itemsApi = new ItemsApi(api.configuration);
          const { data } = await itemsApi.getItems({
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
          return [];
        }
      },

      searchItems: async (query: string): Promise<JellyfinItem[]> => {
        const { api, user } = get();
        if (!api || !user || !query.trim()) return [];

        try {
          const itemsApi = new ItemsApi(api.configuration);
          const { data } = await itemsApi.getItems({
            userId: user.Id,
            searchTerm: query,
            includeItemTypes: [
              BaseItemKind.Movie,
              BaseItemKind.Series,
              BaseItemKind.Episode,
            ],
            recursive: true,
            limit: 50,
            fields: [
              ItemFields.CanDelete,
              ItemFields.PrimaryImageAspectRatio,
              ItemFields.Overview,
            ],
          });

          const items = data.Items || [];
          // Sort items to prioritize Movies and Series over Episodes
          return items.sort((a: JellyfinItem, b: JellyfinItem) => {
            const typePriority = { Movie: 1, Series: 2, Episode: 3 };
            const aPriority =
              typePriority[a.Type as keyof typeof typePriority] || 4;
            const bPriority =
              typePriority[b.Type as keyof typeof typePriority] || 4;
            return aPriority - bPriority;
          });
        } catch (error) {
          console.error("Failed to search items:", error);
          return [];
        }
      },

      fetchMovieDetails: async (
        movieId: string
      ): Promise<JellyfinItem | null> => {
        const { api, user } = get();
        console.log(api, user);
        if (!api || !user) return null;

        try {
          const userLibraryApi = new UserLibraryApi(api.configuration);
          const { data } = await userLibraryApi.getItem({
            userId: user.Id,
            itemId: movieId,
          });
          return data;
        } catch (error) {
          console.error("Failed to fetch movie details:", error);
          return null;
        }
      },

      fetchTVShowDetails: async (
        tvShowId: string
      ): Promise<JellyfinItem | null> => {
        const { api, user } = get();
        if (!api || !user) return null;

        try {
          const userLibraryApi = new UserLibraryApi(api.configuration);
          const { data } = await userLibraryApi.getItem({
            userId: user.Id,
            itemId: tvShowId,
          });
          return data;
        } catch (error) {
          console.error("Failed to fetch TV show details:", error);
          return null;
        }
      },

      fetchSeasons: async (tvShowId: string): Promise<JellyfinItem[]> => {
        const { api, user } = get();
        if (!api || !user) return [];

        try {
          const itemsApi = new ItemsApi(api.configuration);
          const { data } = await itemsApi.getItems({
            userId: user.Id,
            parentId: tvShowId,
            includeItemTypes: [BaseItemKind.Season],
            recursive: false,
            sortBy: [ItemSortBy.SortName],
            sortOrder: [SortOrder.Ascending],
          });
          return data.Items || [];
        } catch (error) {
          console.error("Failed to fetch seasons:", error);
          return [];
        }
      },

      fetchEpisodes: async (seasonId: string): Promise<JellyfinItem[]> => {
        const { api, user } = get();
        if (!api || !user) return [];

        try {
          const itemsApi = new ItemsApi(api.configuration);
          const { data } = await itemsApi.getItems({
            userId: user.Id,
            parentId: seasonId,
            includeItemTypes: [BaseItemKind.Episode],
            recursive: false,
            sortBy: [ItemSortBy.SortName],
            sortOrder: [SortOrder.Ascending],
            fields: [
              ItemFields.CanDelete,
              ItemFields.PrimaryImageAspectRatio,
              ItemFields.Overview,
              ItemFields.MediaSources,
            ],
          });
          return data.Items || [];
        } catch (error) {
          console.error("Failed to fetch episodes:", error);
          return [];
        }
      },

      getImageUrl: (
        itemId: string,
        imageType: string = "Primary",
        tag?: string
      ): string => {
        const { serverUrl } = get();
        if (!serverUrl) return "";

        let url = `${serverUrl}/Items/${itemId}/Images/${imageType}`;
        if (tag) {
          url += `?tag=${tag}`;
        }
        return url;
      },

      getDownloadUrl: (itemId: string, mediaSourceId: string): string => {
        const { serverUrl, user } = get();
        if (!serverUrl || !user) return "";
        return `${serverUrl}/Items/${itemId}/Download?api_key=${user.AccessToken}&MediaSourceId=${mediaSourceId}`;
      },

      getStreamUrl: (
        itemId: string,
        mediaSourceId: string,
        quality?: string
      ): string => {
        const { serverUrl, user } = get();
        if (!serverUrl || !user) return "";
        
        // Generate a unique PlaySessionId for each stream request
        const playSessionId = crypto.randomUUID();
        
        let url = `${serverUrl}/Videos/${itemId}/master.m3u8?api_key=${user.AccessToken}&MediaSourceId=${mediaSourceId}&PlaySessionId=${playSessionId}&VideoCodec=h264,hevc&AudioCodec=aac,mp3&TranscodingProfile=Default`;

        if (quality) {
          switch (quality) {
            case "2160p":
              url += "&width=3840&height=2160&videoBitRate=20000000";
              break;
            case "1080p":
              url += "&width=1920&height=1080&videoBitRate=8000000";
              break;
            case "720p":
              url += "&width=1280&height=720&videoBitRate=4000000";
              break;
          }
        }

        return url;
      },
      getSubtitleTracks: async (
        itemId: string,
        mediaSourceId: string
      ): Promise<Array<{kind: string, label: string, language: string, src: string, default?: boolean}>> => {
        const { serverUrl, user } = get();
        if (!serverUrl || !user) return [];
        try {
          // First get the media item to find subtitle streams
          const userLibraryApi = new UserLibraryApi(get().api!.configuration);
          const { data: item } = await userLibraryApi.getItem({
            userId: user.Id,
            itemId: itemId,
          });
          
          const mediaSource = item.MediaSources?.find(ms => ms.Id === mediaSourceId);
          const subtitleStreams = mediaSource?.MediaStreams?.filter(stream => stream.Type === 'Subtitle') || [];
          
          const subtitleTracks = subtitleStreams.map(stream => {
            const src = `${serverUrl}/Videos/${itemId}/${mediaSourceId}/Subtitles/${stream.Index}/Stream.vtt?api_key=${user.AccessToken}`;
            return {
              kind: "subtitles",
              label: stream.DisplayTitle || stream.Language || `Track ${stream.Index}`,
              language: stream.Language || "unknown",
              src: src,
              default: stream.IsDefault || false
            };
          });
          
          return subtitleTracks;
        } catch (error) {
          console.error("Failed to fetch subtitle tracks:", error);
          return [];
        }
      },
    }),
    {
      name: "jellyfin-auth",
      partialize: (state) => ({
        serverUrl: state.serverUrl,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => {
        return (state) => {
          if (state && state.serverUrl && state.user?.AccessToken) {
            const api = jellyfin.createApi(state.serverUrl);
            api.accessToken = state.user.AccessToken;
            state.api = api;
          }
        };
      },
    }
  )
);
