import { MediaDetailScreen } from '@/components/details/media-detail-screen';
import { useLocalSearchParams } from 'expo-router';

export default function MovieScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <MediaDetailScreen type="movie" id={typeof id === 'string' ? id : ''} />;
}
