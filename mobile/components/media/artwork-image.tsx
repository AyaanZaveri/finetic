import { Icon } from '@/components/ui/icon';
import { Image } from 'expo-image';
import { Film } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

export function ArtworkImage({ uri, fallback, recyclingKey }: { uri?: string; fallback?: string; recyclingKey: string }) {
  const reducedMotion = useReducedMotion();
  const [failed, setFailed] = useState<string[]>([]);
  const source = [uri, fallback].find(value => value && !failed.includes(value));
  return (
    <View className="flex-1 items-center justify-center overflow-hidden bg-muted">
      <Icon as={Film} size={24} className="text-muted-foreground" />
      {source && <Image source={source} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk"
        recyclingKey={`${recyclingKey}-${source}`} transition={reducedMotion ? 0 : 150} onError={() => setFailed(previous => [...previous, source])} />}
    </View>
  );
}
