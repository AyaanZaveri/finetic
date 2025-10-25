import { fetchResumeItems, fetchNextUpItems, fetchLibraryItems } from "@/app/actions/media";
import { getAuthData, getUserLibraries } from "@/app/actions/utils";
import { AuthErrorHandler } from "@/app/components/auth-error-handler";
import { VibrantAuroraBackground } from "@/components/vibrant-aurora-background";
import { MediaSection } from "@/components/media-section";
import { SearchBar } from "@/components/search-component";
import { BaseItemDto } from "@jellyfin/sdk/lib/generated-client/models/base-item-dto";
import { AuroraBackground } from "@/components/aurora-background";

export default async function Home() {
  let serverUrl = "";
  let user = null;
  let resumeItems: BaseItemDto[] = [];
  let nextUpItems: BaseItemDto[] = [];
  let libraries: { library: any; items: BaseItemDto[] }[] = [];
  let authError = null;

  try {
    const authData = await getAuthData();
    serverUrl = authData.serverUrl;
    user = authData.user;

    // Fetch resume items and all user libraries
    const [resumeItemsResult, nextUpItemsResult, userLibraries] = await Promise.all([
      fetchResumeItems(),
      fetchNextUpItems(),
      getUserLibraries(),
    ]);

    resumeItems = resumeItemsResult;
    nextUpItems = nextUpItemsResult
      .filter(item => !resumeItems
        .some(resumeItem => resumeItem.Id === item.Id));

    // Fetch items for each library
    const libraryPromises = userLibraries.map(async (library) => {
      const { items } = await fetchLibraryItems(library.Id, 12);
      return { library, items };
    });

    libraries = await Promise.all(libraryPromises);
  } catch (error) {
    if ((error as any).isAuthError) {
      authError = error;
    } else {
      console.error("Failed to load data:", error);
    }
  }

  return (
    <AuthErrorHandler error={authError}>
      <div className="relative px-4 py-6 max-w-full overflow-hidden">
        <AuroraBackground
          colorStops={["#60a5fa", "#38bdf8", "#22d3ee"]}
          amplitude={0.5}
          className="fixed inset-0 z-0 pointer-events-none opacity-40"
        />

        <div className="relative z-[9999] mb-8">
          <div className="mb-6">
            <SearchBar />
          </div>
        </div>

        <div className="relative z-10 mb-8">
          <h2 className="text-3xl font-semibold text-foreground mb-2 font-poppins">
            Welcome back, {user?.Name}
          </h2>
          <p className="text-muted-foreground mb-6">
            Continue watching or discover something new
          </p>
        </div>

        {resumeItems.length > 0 && (
          <MediaSection
            sectionName="Continue Watching"
            mediaItems={resumeItems}
            serverUrl={serverUrl}
            continueWatching
          />
        )}

        {nextUpItems.length > 0 && (
          <MediaSection
            sectionName="Continue Watching"
            mediaItems={nextUpItems}
            serverUrl={serverUrl}
            continueWatching
          />
        )}

        {libraries.map(({ library, items }) => (
          <MediaSection
            key={library.Id}
            sectionName={library.Name}
            mediaItems={items}
            serverUrl={serverUrl}
          />
        ))}
      </div>
    </AuthErrorHandler>
  );
}
