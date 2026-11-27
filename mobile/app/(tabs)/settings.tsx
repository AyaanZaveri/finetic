import { useMetadataProvider } from '@/lib/metadata-provider';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { Icon } from '@/components/ui/icon';
import { useRouter } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function SettingsScreen() {
  const { top } = useSafeAreaInsets();
  const { provider, setProvider } = useMetadataProvider();
  const { setColorScheme } = useColorScheme();
  const [appearance, setAppearance] = useState<'system' | 'light' | 'dark'>('system');
  const router = useRouter();
  return (
    <ScrollView testID="settings-page" className="flex-1 bg-background" contentContainerStyle={{ paddingTop: Platform.OS === "ios" ? 12 : top + 12, paddingHorizontal: 16, paddingBottom: 16 }}>
      <Text role="heading" className="text-3xl font-nav-semibold tracking-tight">Settings</Text>
      <View className="gap-3 pt-6">
        <Text role="heading" className="text-lg font-nav-medium">Appearance</Text>
        <View className="flex-row gap-2">
          {(['system', 'light', 'dark'] as const).map(mode => <Button key={mode} testID={`setting-appearance-${mode}`} containerClassName="flex-1" variant={appearance === mode ? 'secondary' : 'outline'} accessibilityState={{ selected: appearance === mode }} haptic="selection" onPress={() => { setAppearance(mode); setColorScheme(mode); }}><Text>{mode[0].toUpperCase() + mode.slice(1)}</Text></Button>)}
        </View>
        <Text role="heading" className="text-lg font-nav-medium pt-4">Metadata provider</Text>
        <View className="flex-row gap-2">
          {(['cinemeta', 'tmdb'] as const).map(value => <Button key={value} testID={`setting-provider-${value}`} containerClassName="flex-1" variant={provider === value ? 'secondary' : 'outline'} accessibilityState={{ selected: provider === value }} haptic="selection" onPress={() => setProvider(value)}><Text>{value === 'cinemeta' ? 'Cinemeta' : 'TMDB'}</Text></Button>)}
        </View>
        <Text variant="muted">Cinemeta is the default. TMDB uses the Navigator metadata service.</Text>
        <Text role="heading" className="text-lg font-nav-medium pt-4">About</Text>
        <Button testID="open-design-system" variant="outline" className="justify-between" onPress={() => router.push('/design-system')}><Text>Design system</Text><Icon as={ChevronRight} size={18} /></Button>
        <Text variant="muted">Navigator Mobile</Text>
      </View>
    </ScrollView>
  );
}
