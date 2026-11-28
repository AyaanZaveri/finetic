import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { stremioStreams } from '@/lib/stream-session';
import { THEME } from '@/lib/theme';
import { BottomSheetScrollView, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Image } from 'expo-image';
import { X } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Keyboard, Linking, Pressable, StyleSheet, View, type TextInput } from 'react-native';

// Same official Stremio brand artwork as Navigator web's account form.
const stremioLogo = require('@/assets/images/stremio.svg');
const signUpUrl = 'https://web.stremio.com/#/intro';

function waitForPoll(ms: number, signal: AbortSignal) {
  return new Promise<void>(resolve => {
    if (signal.aborted) { resolve(); return; }
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}

export function StreamSignIn({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme ?? 'light'];
  const passwordInput = useRef<ComponentRef<typeof BottomSheetTextInput>>(null);
  const request = useRef<AbortController | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState<'email' | 'stremio' | null>(null);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => { request.current?.abort(); }, []);

  const cancel = () => {
    request.current?.abort();
    request.current = null;
    setPending(null);
    setLinkUrl(null);
    setError(null);
  };
  const close = () => { cancel(); onClose(); };
  const openUrl = async (url: string) => {
    try { await Linking.openURL(url); }
    catch { setError('Could not open Stremio. Try again.'); }
  };

  const authenticate = async (method: 'email' | 'stremio') => {
    if (request.current || (method === 'email' && (!email.trim() || !password))) return;
    const controller = new AbortController();
    const { signal } = controller;
    request.current = controller;
    setPending(method);
    setError(null);
    Keyboard.dismiss();
    try {
      if (method === 'email') await stremioStreams.signIn(email.trim(), password, signal);
      else {
        const link = await stremioStreams.startLink(signal);
        if (signal.aborted) return;
        setLinkUrl(link.url);
        void openUrl(link.url);
        await waitForPoll(1000, signal);
        while (!signal.aborted && Date.now() < link.expiresAt) {
          const result = await stremioStreams.finishLink(link.code, signal);
          if (signal.aborted) return;
          if (result === 'signed-in') { onSuccess(); return; }
          if (result === 'expired') break;
          await waitForPoll(3000, signal);
        }
        if (!signal.aborted) setError('This sign-in link expired. Start again.');
        return;
      }
      if (!signal.aborted) onSuccess();
    } catch (error) {
      if (!signal.aborted) setError(error instanceof Error ? error.message : 'Could not sign in. Try again.');
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(null);
        setLinkUrl(null);
      }
    }
  };

  // Gorhom types the ref as the gesture wrapper, but forwards the native input.
  const focusPassword = () => (passwordInput.current as unknown as TextInput | null)?.focus();
  const inputStyle = [styles.input, { backgroundColor: theme.muted, color: theme.foreground }];
  return <BottomSheetScrollView
    accessibilityViewIsModal accessible={false} onAccessibilityEscape={close}
    keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
    <View className="flex-row items-center gap-2">
      <Text testID="sign-in-title" role="heading" className="flex-1 text-xl font-nav-semibold">Sign in</Text>
      <Button testID="sign-in-close" size="icon" variant="ghost" accessibilityLabel="Close sign-in" haptic="selection" onPress={close}>
        <Icon as={X} size={21} />
      </Button>
    </View>
    <Button testID="sign-in-stremio" accessibilityLabel="Sign in with Stremio" variant="outline" style={styles.provider}
      disabled={pending !== null} loading={pending === 'stremio' && !linkUrl} haptic="impact" onPress={() => void authenticate('stremio')}>
      <Image source={stremioLogo} style={styles.logo} contentFit="contain" accessible={false} />
      <Text className="shrink">Sign in with Stremio</Text>
    </Button>
    {linkUrl && <View className="gap-1 items-center">
      <Text variant="muted" className="text-center" accessibilityLiveRegion="polite">Complete sign-in in your browser, then return here</Text>
      <View className="flex-row flex-wrap justify-center gap-2">
        <Button variant="ghost" size="sm" onPress={() => void openUrl(linkUrl)}><Text>Open Stremio</Text></Button>
        <Button variant="ghost" size="sm" onPress={cancel}><Text variant="muted">Cancel</Text></Button>
      </View>
    </View>}
    <View className="flex-row items-center gap-3">
      <View className="flex-1 bg-border" style={styles.rule} />
      <Text variant="muted" className="text-xs">or</Text>
      <View className="flex-1 bg-border" style={styles.rule} />
    </View>
    <View className="gap-1.5">
      <Text className="text-sm font-nav-medium">Email</Text>
      <BottomSheetTextInput testID="sign-in-email" accessibilityLabel="Email" autoCapitalize="none" autoCorrect={false}
        autoComplete="username" textContentType="username" returnKeyType="next" submitBehavior="submit" onSubmitEditing={focusPassword}
        keyboardType="email-address" value={email} onChangeText={value => { setEmail(value); setError(null); }} editable={pending === null}
        maxLength={320} style={inputStyle} placeholderTextColor={theme.mutedForeground} placeholder="you@example.com" />
    </View>
    <View className="gap-1.5">
      <Text className="text-sm font-nav-medium">Password</Text>
      <BottomSheetTextInput ref={passwordInput} accessibilityLabel="Password" secureTextEntry autoComplete="current-password" textContentType="password"
        returnKeyType="go" onSubmitEditing={() => void authenticate('email')} value={password}
        onChangeText={value => { setPassword(value); setError(null); }} editable={pending === null} maxLength={4096}
        style={inputStyle} placeholderTextColor={theme.mutedForeground} placeholder="Password" />
    </View>
    {error && <Text accessibilityRole="alert" className="text-sm text-destructive">{error}</Text>}
    <Button testID="sign-in-submit" accessibilityLabel="Sign in" loading={pending === 'email'} disabled={pending !== null || !email.trim() || !password}
      onPress={() => void authenticate('email')} haptic="impact"><Text>Sign in</Text></Button>
    <Pressable accessibilityRole="link" accessibilityLabel="Sign up for Stremio" onPress={() => void openUrl(signUpUrl)} className="min-h-12 items-center justify-center">
      <Text variant="muted" className="text-center">Don&apos;t have an account? <Text className="text-sm font-nav-medium underline">Sign up</Text></Text>
    </Pressable>
  </BottomSheetScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 16, gap: 10 },
  input: { minHeight: 48, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, fontSize: 16 },
  provider: { backgroundColor: 'transparent' },
  logo: { width: 16, height: 16, flexShrink: 0 },
  rule: { height: StyleSheet.hairlineWidth },
});
