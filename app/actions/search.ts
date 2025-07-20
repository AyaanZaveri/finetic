'use server';

import { cookies } from 'next/headers';
import { Jellyfin } from "@jellyfin/sdk";
import { ItemsApi } from "@jellyfin/sdk/lib/generated-client/api/items-api";
import { PeopleApi } from "@jellyfin/sdk/lib/generated-client/api/people-api";
import { BaseItemDto } from "@jellyfin/sdk/lib/generated-client/models/base-item-dto";
import { BaseItemKind } from "@jellyfin/sdk/lib/generated-client/models/base-item-kind";
import { ItemFields } from "@jellyfin/sdk/lib/generated-client/models/item-fields";

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
  const authData = cookieStore.get('jellyfin-auth');

  if (!authData?.value) {
    throw new Error('Not authenticated');
  }

  const parsed = JSON.parse(authData.value);
  return { serverUrl: parsed.serverUrl, user: parsed.user };
}

export async function searchItems(query: string): Promise<JellyfinItem[]> {
  const { serverUrl, user } = await getAuthData();
  
  if (!query.trim()) return [];

  const api = jellyfin.createApi(serverUrl);
  api.accessToken = user.AccessToken;

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
      const aPriority = typePriority[a.Type as keyof typeof typePriority] || 4;
      const bPriority = typePriority[b.Type as keyof typeof typePriority] || 4;
      return aPriority - bPriority;
    });
  } catch (error) {
    console.error("Failed to search items:", error);
    return [];
  }
}

export async function searchPeople(query: string): Promise<JellyfinItem[]> {
    const { serverUrl, user } = await getAuthData();

    if (!query.trim()) return [];

    const api = jellyfin.createApi(serverUrl);
    api.accessToken = user.AccessToken;

    try {
        const peopleApi = new PeopleApi(api.configuration);
        const { data } = await peopleApi.getPersons({
            userId: user.Id,
            searchTerm: query,
            limit: 20,
        });

        return data.Items || [];
    } catch (error) {
        console.error("Failed to search people:", error);
        return [];
    }
}
