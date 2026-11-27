import '@/global.css';

import { MetadataProviderRoot } from '@/lib/metadata-provider';
import { NAV_THEME } from '@/lib/theme';
import { ThemeProvider } from 'expo-router/react-navigation';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PortalHost } from '@rn-primitives/portal';
import { useFonts } from 'expo-font';
import { ExperimentalStack, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'nativewind';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

export { ErrorBoundary } from 'expo-router';

const queryClient = new QueryClient();

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
        <QueryClientProvider client={queryClient}>
          <MetadataProviderRoot>
          <BottomSheetModalProvider>
            {Platform.OS === 'android' ? (
              <ExperimentalStack initialRouteName="(tabs)" screenOptions={{ headerShown: false }}>
                <ExperimentalStack.Screen name="(tabs)" />
                <ExperimentalStack.Screen name="design-system" options={{ headerShown: true, title: 'Design system' }} />
              </ExperimentalStack>
            ) : (
              <Stack initialRouteName="(tabs)" screenOptions={{ headerShown: false, headerShadowVisible: false }}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="design-system" options={{ headerShown: true, title: 'Design system' }} />
              </Stack>
            )}
            <PortalHost />
          </BottomSheetModalProvider>
          </MetadataProviderRoot>
        </QueryClientProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
