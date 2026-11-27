import { DetailChip } from './detail-chip';
import { Text } from '@/components/ui/text';
import { ratingLabel, type MediaItem } from '@/lib/home-catalog';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

// Original vector artwork and clear space from public/logo/imdb-black.svg
// and public/logo/imdb-gold.svg. Keep these in sync with the web badge.
const IMDbLogoPath = 'M197,122.7v255.4h-66.2V122.7h66.2ZM338.4,122.7l-15.3,119.4-9.4-64.9c-2.8-20.8-5.4-39-8-54.5h-85.9v255.4h58.1l.3-168.6,24.4,168.6h41.4l23.3-172.3v172.3h58.1V122.7h-86.7ZM447.7,378.1V122.7h49.4c32.1,0,50.6,1.5,61.9,4.5,11.3,3,19.9,7.8,25.7,14.5,6,6.7,9.7,14.2,11.1,22.4,1.4,8.3,2.4,24.5,2.4,48.7v89.6c0,22.9-1.2,38.3-3.5,45.9-2.1,7.7-5.9,13.7-11.3,18.1-5.3,4.5-12,7.4-19.8,9.2-7.9,1.7-19.8,2.6-35.7,2.6h-80.4ZM513.9,166.4v167.6c9.5,0,15.4-1.9,17.6-5.7,2.2-3.8,3.4-14.2,3.4-31.3v-98.9c0-11.5-.4-18.9-1.1-22.2-.7-3.3-2.5-5.7-5.1-7.2-2.6-1.6-7.6-2.3-14.7-2.3ZM684.7,122.7v83.1c5.3-6.1,11.3-10.6,17.7-13.6,6.6-3.1,16.3-4.6,23.9-4.6s16.4,1.4,22.9,4.1c6.4,2.7,11.3,6.6,14.7,11.5,3.3,5,5.4,9.8,6.1,14.5.7,4.7,1,14.7,1,30.2v71.7c0,15.2-1,26.6-3.1,34.2-2,7.4-6.8,14-14.5,19.4-7.6,5.6-16.7,8.3-27.1,8.3s-17.2-1.6-23.8-4.8c-6.6-3.4-12.5-8.2-17.8-14.7l-4.2,16.2h-59.7V122.7h63.9ZM707.1,250.7c0-10.8-.7-17.8-2.1-21.2-1.4-3.2-6.8-5-10.9-5s-6.4,1.5-7.7,4.3c-1.1,3-1.7,10.2-1.7,21.8v67.5c0,11.3.7,18.4,2,21.5,1.4,3.2,4,4.7,7.9,4.7s9.4-1.6,10.7-4.8c1.2-3.2,1.9-11.1,1.9-23.4v-65.5Z';

export function MediaRatingBadge({ item, light }: { item: MediaItem; light: boolean }) {
  const rating = ratingLabel(item);
  if (!rating) return null;
  const imdb = Number(item.imdbRating);
  const hasIMDb = Number.isFinite(imdb) && imdb > 0 && imdb <= 10;
  const source = hasIMDb ? 'IMDb' : item.ratingSource || (item.id.startsWith('tmdb:') ? 'TMDB' : 'Rating');
  return (
    <DetailChip accessible accessibilityLabel={`${source} ${rating} out of 10`} style={hasIMDb ? { gap: 0, paddingStart: 4, paddingEnd: 8 } : undefined}>
      {hasIMDb && <View className="h-4 w-9 items-center justify-center" accessible={false}>
        <Svg width={36} height={20} viewBox="0 0 900 500" accessible={false}>
          <Path d={IMDbLogoPath} fill={light ? '#161616' : '#f5c518'} />
        </Svg>
      </View>}
      <Text style={{ fontVariant: ['tabular-nums'] }}>{hasIMDb ? rating : `${source} ${rating}`}</Text>
    </DetailChip>
  );
}
