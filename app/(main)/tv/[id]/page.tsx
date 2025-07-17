import { TVShowPage } from "@/components/tv-show-page";

export default async function TVShow({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TVShowPage tvShowId={id} />;
}
