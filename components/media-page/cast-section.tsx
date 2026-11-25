import { CastScrollArea } from "@/components/cast-scrollarea";
import { getMediaCast } from "@/lib/tmdb-cast";
import titleStyles from "@/components/media-page/title-detail.module.css";

export async function CastSection({ id, type, names }: { id: string; type: "movie" | "series"; names?: string[] }) {
    const { members } = await getMediaCast(id, type, names);
    if (!members.length) return null;

    return (
        <div className={`${titleStyles.sectionGutter} mt-2 px-4 md:px-10`}>
            <CastScrollArea cast={members} />
        </div>
    );
}
