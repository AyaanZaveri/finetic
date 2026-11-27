import { MediaDetailScreen } from '@/components/details/media-detail-screen';
import { useLocalSearchParams } from 'expo-router';

export default function EpisodeScreen() {
  const { id, season, episode } = useLocalSearchParams<{ id: string; season: string; episode: string }>();
  const s = Number(season), e = Number(episode);
  return <MediaDetailScreen key={`${id}:${s}:${e}`} type="series" id={typeof id === 'string' ? id : ''} episode={Number.isSafeInteger(s) && s >= 0 && Number.isSafeInteger(e) && e >= 1 ? { season: s, number: e } : undefined} />;
}
