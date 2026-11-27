import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { GlassSurface } from '@/components/effects/glass-surface';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Text } from '@/components/ui/text';
import { triggerHaptic } from '@/lib/haptics';
import { Stack } from 'expo-router';
import { Check, Moon, Search, Sun } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Native design-system preview and regression-test route. */
export default function FoundationScreen() {
  const { colorScheme, setColorScheme } = useColorScheme();
  const [appearance, setAppearance] = useState<'light' | 'dark' | 'system'>('system');
  const [sample, setSample] = useState('');
  const [haptics, setHaptics] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const insets = useSafeAreaInsets();

  return (
    <>
      <Stack.Screen options={{ title: 'Design system' }} />
      <ScrollView className="flex-1 bg-background" contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: insets.bottom + 24 }}>
        <View className="mx-auto w-full max-w-lg gap-6">
          <View className="gap-2">
            <Badge variant="secondary" className="self-start"><Text>Mobile foundation</Text></Badge>
            <Text className="text-3xl font-nav-semibold tracking-tight" role="heading">Navigator</Text>
            <Text className="text-muted-foreground">Native component preview. Test appearance, controls and materials here.</Text>
          </View>
          <View className="gap-3">
            <Text className="text-xl font-nav-semibold" role="heading">Appearance</Text>
            <View className="flex-row gap-2">
              {(['light', 'dark', 'system'] as const).map((mode) => (
                <Button key={mode} testID={`appearance-${mode}`} variant="outline" className="flex-1" haptic={haptics ? 'selection' : 'none'}
                  onPress={() => { setAppearance(mode); setColorScheme(mode); }} accessibilityLabel={`${mode} appearance`} accessibilityState={{ selected: appearance === mode }}>
                  {mode === appearance && <Icon as={Check} size={14} />}
                  <Text>{mode[0].toUpperCase() + mode.slice(1)}</Text>
                </Button>
              ))}
            </View>
          </View>
          <Card className="gap-4 py-4 shadow-none">
            <CardHeader className="px-4"><CardTitle>Controls</CardTitle><CardDescription>Locally owned React Native Reusables components.</CardDescription></CardHeader>
            <CardContent className="gap-4 px-4">
              <View className="gap-2">
                <Text className="text-sm font-nav-medium">Search field</Text>
                <Input testID="preview-input" value={sample} onChangeText={setSample} placeholder="Search movies and shows" accessibilityLabel="Search field preview" returnKeyType="search" />
              </View>
              <Button testID="preview-action" haptic={haptics ? 'impact' : 'none'} onPress={() => setConfirmed((previous) => !previous)}>
                <Icon as={confirmed ? Check : Search} size={16} />
                <Text>{confirmed ? 'Confirmed' : 'Primary action'}</Text>
              </Button>
              <View className="flex-row gap-2">
                <Button testID="preview-clear" variant="outline" className="flex-1" onPress={() => setSample('')}><Text>Clear example</Text></Button>
                <Button testID="preview-disabled" variant="destructive" className="flex-1" disabled><Text>Disabled</Text></Button>
              </View>
              <Separator />
              <View className="min-h-12 flex-row items-center justify-between gap-4">
                <View className="flex-1 gap-1"><Text className="font-nav-medium">Haptic feedback</Text><Text variant="muted">Try selection and action feedback.</Text></View>
                <Switch testID="preview-haptics" checked={haptics} onCheckedChange={(next) => { if (next) triggerHaptic('selection'); setHaptics(next); }} accessibilityLabel="Haptic feedback" />
              </View>
            </CardContent>
          </Card>
          <View className="gap-3">
            <Text className="text-xl font-nav-semibold" role="heading">Floating material</Text>
            <View className="items-start rounded-2xl bg-muted p-5">
              <GlassSurface style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                <Icon as={colorScheme === 'dark' ? Moon : Sun} size={18} />
                <Text className="text-sm font-nav-medium">Adaptive glass surface</Text>
              </GlassSurface>
            </View>
            <Text variant="muted">Uses native Liquid Glass where available and a solid surface otherwise.</Text>
          </View>
        </View>
      </ScrollView>
    </>
  );
}
