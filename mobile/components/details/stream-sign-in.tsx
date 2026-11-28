import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { stremioStreams } from '@/lib/stream-session';
import { THEME } from '@/lib/theme';
import { BottomSheetScrollView, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Image } from 'expo-image';
import { useColorScheme } from 'nativewind';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Keyboard, Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

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

export function StreamSignIn({ onClose, onSuccess, presentation }: { onClose: () => void; onSuccess: () => void; presentation: 'sheet' | 'dialog' }) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme ?? 'light'];
  const passwordInput = useRef<TextInput>(null);
  const request = useRef<AbortController | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState<'email' | 'stremio' | null>(null);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility('Sign in');
    return () => { request.current?.abort(); };
  }, []);

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

  const FormScrollView = presentation === 'dialog' ? ScrollView : BottomSheetScrollView;
  const FormInput = presentation === 'dialog' ? TextInput : BottomSheetTextInput;
  const inputStyle = [styles.input, { backgroundColor: theme.muted, color: theme.foreground }];
  return <FormScrollView
    accessibilityViewIsModal accessible={false} onAccessibilityEscape={close}
    keyboardShouldPersistTaps="handled" style={presentation === 'dialog' ? styles.dialogScroll : undefined}
    contentContainerStyle={presentation === 'dialog' ? [styles.content, styles.dialogContent] : styles.content}>
    <Button testID="sign-in-stremio" accessibilityLabel="Sign in with Stremio" className="rounded-full"
      onAccessibilityEscape={close}
      disabled={pending !== null} loading={pending === 'stremio' && !linkUrl} haptic="impact" onPress={() => void authenticate('stremio')}>
      <Image source={stremioLogo} style={styles.logo} contentFit="contain" accessible={false} />
      <Text className="shrink text-[17px] font-nav-semibold">Sign in with Stremio</Text>
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
      <FormInput testID="sign-in-email" accessibilityLabel="Email" autoCapitalize="none" autoCorrect={false}
        autoComplete="username" textContentType="username" returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => passwordInput.current?.focus()}
        keyboardType="email-address" value={email} onChangeText={value => { setEmail(value); setError(null); }} editable={pending === null}
        maxLength={320} style={inputStyle} placeholderTextColor={theme.mutedForeground} placeholder="you@example.com" />
    </View>
    <View className="gap-1.5">
      <Text className="text-sm font-nav-medium">Password</Text>
      <FormInput ref={(input: unknown) => { passwordInput.current = input as TextInput | null; }} accessibilityLabel="Password" secureTextEntry autoComplete="current-password" textContentType="password"
        returnKeyType="go" onSubmitEditing={() => void authenticate('email')} value={password}
        onChangeText={value => { setPassword(value); setError(null); }} editable={pending === null} maxLength={4096}
        style={inputStyle} placeholderTextColor={theme.mutedForeground} placeholder="Password" />
    </View>
    {error && <Text accessibilityRole="alert" className="text-sm text-destructive">{error}</Text>}
    <Button testID="sign-in-submit" accessibilityLabel="Sign in" variant="secondary" loading={pending === 'email'} disabled={pending !== null || !email.trim() || !password}
      className="rounded-full" onPress={() => void authenticate('email')} haptic="impact"><Text className="text-[17px] font-nav-semibold">Sign in</Text></Button>
    <Pressable testID="sign-in-sign-up" accessibilityRole="link" accessibilityLabel="Sign up for Stremio" onPress={() => void openUrl(signUpUrl)}
      className="min-h-12 items-center justify-center active:opacity-75">
      <Text variant="muted" className="text-center">Don&apos;t have an account? <Text className="text-sm font-nav-semibold text-foreground">Sign up</Text></Text>
    </Pressable>
  </FormScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingTop: 6, paddingHorizontal: 16, paddingBottom: 16, gap: 10 },
  dialogScroll: { flexGrow: 0 },
  dialogContent: { paddingTop: 24, paddingHorizontal: 24, paddingBottom: 16, gap: 12 },
  input: { minHeight: 48, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, fontSize: 16 },
  logo: { width: 16, height: 16, flexShrink: 0 },
  rule: { height: StyleSheet.hairlineWidth },
});
