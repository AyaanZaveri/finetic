import { MediaDetailScreen } from '@/components/details/media-detail-screen';
import { useLocalSearchParams } from 'expo-router';

export default function SeriesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <MediaDetailScreen type="series" id={typeof id === 'string' ? id : ''} />;
}
