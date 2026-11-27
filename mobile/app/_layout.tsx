import '@/global.css';

import { NAV_THEME } from '@/lib/theme';
import { ThemeProvider } from 'expo-router/react-navigation';
import { PortalHost } from '@rn-primitives/portal';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'nativewind';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

export { ErrorBoundary } from 'expo-router';

void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const { colorScheme } = useColorScheme();
  const [loaded, error] = useFonts({
    'SunghyunSans-Regular': require('../assets/fonts/SunghyunSans-Regular.otf'),
    'SunghyunSans-Medium': require('../assets/fonts/SunghyunSans-Medium.otf'),
    'SunghyunSans-SemiBold': require('../assets/fonts/SunghyunSans-SemiBold.otf'),
    'SunghyunSans-Bold': require('../assets/fonts/SunghyunSans-Bold.otf'),
  });
  useEffect(() => {
    if (loaded || error) void SplashScreen.hideAsync().catch(() => {});
  }, [loaded, error]);
  if (error) throw error;
  if (!loaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={NAV_THEME[colorScheme ?? 'light']}>
        <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
        <Stack screenOptions={{ headerShadowVisible: false }} />
        <PortalHost />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
