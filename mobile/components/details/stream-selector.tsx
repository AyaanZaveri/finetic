import { StreamCard } from './stream-card';
import { SignInDialog } from './sign-in-dialog';
import { StreamSignIn } from './stream-sign-in';
import { Button } from '@/components/ui/button';
import { FloatingSheet } from '@/components/ui/floating-sheet';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { emptyStreamSnapshot } from '@/lib/stream-api';
import { stremioStreams } from '@/lib/stream-session';
import {
  filterStreams, getSourceLabel, getStreamPresentation, isSelectableStream, streamFilterGroups, streamFilterLabels,
  type StreamChoice, type StreamTarget,
} from '@/lib/stream-selection';
import { signInPresentation, signInSheetLayout, streamSheetLayout } from '@/lib/stream-sheet';
import { triggerHaptic } from '@/lib/haptics';
import { THEME } from '@/lib/theme';
import { BottomSheetFlatList, BottomSheetModal, BottomSheetScrollView, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { ArrowLeft, Check, ChevronDown, Layers, Search, SearchX, SlidersHorizontal, X } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref, type RefObject } from 'react';
import { ActivityIndicator, BackHandler, Keyboard, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type StreamSelectorHandle = { present: () => void };
type Pane = 'streams' | 'addons' | 'filters';

function StreamSkeleton() {
  return <View accessible={false} className="gap-2 rounded-xl bg-muted p-3">
    <View className="h-4 w-20 rounded bg-secondary" />
    <View className="h-3 w-2/3 rounded bg-secondary" />
    <View className="h-3 w-4/5 rounded bg-secondary" />
  </View>;
}

function EmptyStreams({ title, description, action, onAction }: {
  title: string; description: string; action?: string; onAction?: () => void;
}) {
  return <View className="items-center gap-2 px-4 py-10">
    <View className="size-12 rounded-full bg-muted items-center justify-center">
      <Icon as={SearchX} size={22} className="text-muted-foreground" />
    </View>
    <Text className="text-base font-nav-semibold text-center">{title}</Text>
    <Text variant="muted" className="text-center">{description}</Text>
    {action && <Button variant="secondary" className="mt-2" onPress={onAction}><Text>{action}</Text></Button>}
  </View>;
}

/** Real stream discovery, presented in the same detached material as season selection.
 * Stream selection is a local handoff until the native playback route is connected. */
export function StreamSelector({ ref, target, title, blurTarget, onSelect }: {
  ref: Ref<StreamSelectorHandle>;
  target: StreamTarget;
  title: string;
  blurTarget?: RefObject<View | null>;
  onSelect?: (stream: StreamChoice) => void;
}) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme ?? 'light'];
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const sheet = useRef<BottomSheetModal>(null);
  const discoveryRequest = useRef<AbortController | null>(null);
  const authRequest = useRef<AbortController | null>(null);
  const presented = useRef(false);
  const visible = useRef(false);
  const [open, setOpen] = useState(false);
  const [accountPresentation, setAccountPresentation] = useState<'sheet' | 'dialog'>('sheet');
  const [snapshot, setSnapshot] = useState(emptyStreamSnapshot);
  const [retry, setRetry] = useState(0);
  const [pane, setPane] = useState<Pane>('streams');
  const [search, setSearch] = useState('');
  const [addon, setAddon] = useState<string | null>(null);
  const [filters, setFilters] = useState<string[]>([]);
  const [selected, setSelected] = useState<StreamChoice | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authPending, setAuthPending] = useState(false);
  const targetId = target.id;
  const targetType = target.type;
  const targetSeason = target.type === 'series' ? target.season : undefined;
  const targetEpisode = target.type === 'series' ? target.episode : undefined;
  const preferredPresentation = signInPresentation(width, insets);
  const accountDialog = accountPresentation === 'dialog' && snapshot.signedIn !== true && !visible.current;
  const ready = snapshot.signedIn !== null || snapshot.complete;

  const resetFilters = () => { setSearch(''); setAddon(null); setFilters([]); };
  const reload = useCallback(() => {
    discoveryRequest.current?.abort();
    setSnapshot(previous => ({ ...emptyStreamSnapshot(), signedIn: previous.signedIn }));
    setSelected(null);
    setRetry(value => value + 1);
  }, []);
  const cancelRequests = useCallback(() => {
    discoveryRequest.current?.abort();
    authRequest.current?.abort();
    authRequest.current = null;
  }, []);
  const dismissed = useCallback(() => {
    presented.current = false;
    visible.current = false;
    cancelRequests();
    Keyboard.dismiss();
    setOpen(false);
    setAccountPresentation('sheet');
    setAuthPending(false);
    setAuthError(null);
    setSnapshot(emptyStreamSnapshot());
    setSelected(null);
  }, [cancelRequests]);
  const close = useCallback(() => {
    cancelRequests();
    Keyboard.dismiss();
    if (visible.current) sheet.current?.dismiss();
    else dismissed();
  }, [cancelRequests, dismissed]);
  useImperativeHandle(ref, () => ({
    present() {
      if (presented.current) return;
      presented.current = true;
      // Do not swap the native container while the user is entering text.
      setAccountPresentation(preferredPresentation);
      setPane('streams');
      resetFilters();
      setSnapshot(emptyStreamSnapshot());
      setSelected(null);
      setOpen(true);
    },
  }), [preferredPresentation]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    discoveryRequest.current = controller;
    const requestTarget: StreamTarget = targetType === 'series'
      ? { id: targetId, type: targetType, season: targetSeason!, episode: targetEpisode! }
      : { id: targetId, type: targetType };
    void stremioStreams.loadStreamSnapshot(requestTarget, controller.signal,
      result => { if (!controller.signal.aborted) setSnapshot(result); }).catch(() => {
      if (!controller.signal.aborted) setSnapshot({ ...emptyStreamSnapshot(), complete: true, error: 'Could not load streams. Try again.' });
    });
    return () => {
      controller.abort();
      if (discoveryRequest.current === controller) discoveryRequest.current = null;
    };
  }, [open, retry, targetId, targetType, targetSeason, targetEpisode]);
  useEffect(() => {
    // Resolve the local account state before showing either drawer. A guest
    // never sees the stream header while SecureStore is loading.
    if (!open || !ready || accountDialog || visible.current || !sheet.current) return;
    visible.current = true;
    sheet.current.present();
  }, [open, ready, accountDialog]);
  useEffect(() => cancelRequests, [cancelRequests]);
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (pane !== 'streams') setPane('streams');
      else close();
      return true;
    });
    return () => sub.remove();
  }, [open, pane, close]);

  const signOut = async () => {
    if (authRequest.current) return;
    const controller = new AbortController();
    authRequest.current = controller;
    setAuthPending(true);
    setAuthError(null);
    Keyboard.dismiss();
    try {
      await stremioStreams.signOut(controller.signal);
      if (!controller.signal.aborted) close();
    } catch (error) {
      if (!controller.signal.aborted) setAuthError(error instanceof Error ? error.message : 'Could not update your account. Try again.');
    } finally {
      if (authRequest.current === controller) {
        authRequest.current = null;
        setAuthPending(false);
      }
    }
  };

  // Provider order stays stable as asynchronous add-on results arrive. The
  // row keys are independent of search/filter and never contain stream URLs.
  const rows = useMemo(() => {
    const counts = new Map<number, number>();
    return new Map(snapshot.streams.map(stream => {
      const index = counts.get(stream.addonIndex) ?? 0;
      counts.set(stream.addonIndex, index + 1);
      return [stream, `${stream.addonIndex}:${index}`];
    }));
  }, [snapshot.streams]);
  const results = useMemo(() => filterStreams(snapshot.streams, search, addon, filters), [snapshot.streams, search, addon, filters]);
  const hasFilters = !!search.trim() || addon !== null || filters.length > 0;
  const status = !snapshot.complete
    ? snapshot.pending > 0 ? `${snapshot.pending} add-on${snapshot.pending === 1 ? '' : 's'} loading` : 'Finding streams…'
    : `${results.length} stream${results.length === 1 ? '' : 's'}`;
  const addonName = snapshot.addons.find(row => row.id === addon)?.name ?? 'All add-ons';
  const setSubpane = (next: Pane) => { Keyboard.dismiss(); setPane(next); };
  const toggle = (value: string) => setFilters(previous => previous.includes(value) ? previous.filter(option => option !== value) : [...previous, value]);
  const select = (stream: StreamChoice) => {
    if (!isSelectableStream(stream)) return;
    Keyboard.dismiss();
    setSelected(stream);
    if (onSelect) {
      onSelect(stream);
      close();
    }
  };

  if (snapshot.signedIn !== true) {
    const AccountScrollView = accountDialog ? ScrollView : BottomSheetScrollView;
    const account = snapshot.signedIn === false ? <StreamSignIn onClose={close} onSuccess={close} presentation={accountDialog ? 'dialog' : 'sheet'} /> : (
      <AccountScrollView accessibilityViewIsModal accessible={false} onAccessibilityEscape={close} contentContainerStyle={styles.body}>
        {snapshot.complete ? <>
          <Text accessibilityRole="alert" variant="muted">{snapshot.error ?? 'Could not open sign-in. Try again.'}</Text>
          <Button variant="secondary" onPress={reload}><Text>Try again</Text></Button>
        </> : <ActivityIndicator color={theme.mutedForeground} accessibilityLabel="Checking account" />}
      </AccountScrollView>
    );
    if (accountDialog) return <SignInDialog visible={open && ready} onClose={close}>{account}</SignInDialog>;
    // The edge-to-edge Android portal keeps its full height. Let Gorhom lift
    // the compact form above the IME rather than assuming the portal resized.
    return <FloatingSheet ref={sheet} layout={signInSheetLayout(width, height, insets)}
      onDismiss={dismissed} contentSized solidSurface keyboardClearance={8}
      keyboardBehavior="interactive" keyboardBlurBehavior="restore" android_keyboardInputMode="adjustPan" enableBlurKeyboardOnGesture>
      {account}
    </FloatingSheet>;
  }

  const body = pane === 'addons' ? (
    <BottomSheetScrollView contentContainerStyle={styles.body}>
      {[{ id: null, name: 'All add-ons' }, ...snapshot.addons].map((row, index) =>
        <Button key={row.id ?? 'all'} variant={row.id === addon ? 'secondary' : 'ghost'} className="justify-start" haptic="selection"
          testID={`stream-addon-${index}`} accessibilityState={{ selected: row.id === addon }} onPress={() => { setAddon(row.id); setPane('streams'); }}>
          <Icon as={Layers} size={18} className="text-muted-foreground" />
          <Text className="flex-1 shrink">{row.name}</Text>
          {row.id === addon && <Icon as={Check} size={18} color={theme.primary} />}
        </Button>)}
    </BottomSheetScrollView>
  ) : pane === 'filters' ? (
    <BottomSheetScrollView contentContainerStyle={styles.body}>
      {streamFilterGroups.map(group => <View key={group.label} className="gap-2 pb-4">
        <Text className="text-sm font-nav-semibold">{group.label}</Text>
        <View className="flex-row flex-wrap gap-2">
          {group.options.map(option => {
            const active = filters.includes(option);
            return <Pressable key={option} testID={`stream-filter-${option}`} accessibilityRole="button" accessibilityState={{ selected: active }}
              onPress={() => { triggerHaptic('selection'); toggle(option); }}
              style={({ pressed }) => [styles.chip, { backgroundColor: active ? theme.foreground : pressed ? theme.secondary : theme.muted }]}>
              {active && <Icon as={Check} size={14} color={theme.background} />}
              <Text className="text-sm font-nav-medium" style={{ color: active ? theme.background : theme.foreground }}>{streamFilterLabels[option] ?? option}</Text>
            </Pressable>;
          })}
        </View>
      </View>)}
      <Button onPress={() => setPane('streams')} haptic="selection"><Text>Show {results.length} stream{results.length === 1 ? '' : 's'}</Text></Button>
      {!!filters.length && <Button variant="ghost" onPress={() => setFilters([])} haptic="selection"><Text>Clear filters</Text></Button>}
    </BottomSheetScrollView>
  ) : (
    <BottomSheetFlatList data={results} keyExtractor={row => rows.get(row)!} extraData={selected}
      keyboardShouldPersistTaps="handled" initialNumToRender={8} windowSize={5}
      contentContainerStyle={styles.body} ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
      ListHeaderComponent={<View className="gap-2 pb-3">
        <View style={[styles.search, { backgroundColor: theme.muted }]}>
          <Icon as={Search} size={19} className="text-muted-foreground" />
          <BottomSheetTextInput testID="stream-search" accessibilityLabel="Search streams" placeholder="Search streams" value={search} onChangeText={setSearch}
            autoCorrect={false} returnKeyType="search" maxLength={300} placeholderTextColor={theme.mutedForeground}
            style={[styles.searchInput, { color: theme.foreground }]} onSubmitEditing={Keyboard.dismiss} />
          {!!search && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setSearch('')} style={styles.clear}>
            <Icon as={X} size={18} className="text-muted-foreground" />
          </Pressable>}
        </View>
        <View className="flex-row gap-2">
          <Button testID="stream-addon-filter" variant="secondary" containerClassName="flex-1" className="justify-between px-3" haptic="selection" onPress={() => setSubpane('addons')} disabled={snapshot.signedIn !== true}>
            <Icon as={Layers} size={16} className="text-muted-foreground" />
            <Text className="flex-1 shrink" numberOfLines={1}>{addonName}</Text>
            <Icon as={ChevronDown} size={15} className="text-muted-foreground" />
          </Button>
          <Button testID="stream-quality-filter" variant="secondary" containerClassName="flex-1" className="justify-between px-3" haptic="selection" onPress={() => setSubpane('filters')} disabled={snapshot.signedIn !== true}>
            <Icon as={SlidersHorizontal} size={16} className="text-muted-foreground" />
            <Text className="flex-1 shrink" numberOfLines={1}>Filters{filters.length ? ` (${filters.length})` : ''}</Text>
            <Icon as={ChevronDown} size={15} className="text-muted-foreground" />
          </Button>
        </View>
        <View className="flex-row flex-wrap items-center justify-between gap-2">
          <View className="flex-row items-center gap-2">
            {!snapshot.complete && <ActivityIndicator color={theme.mutedForeground} size="small" />}
            <Text variant="muted" accessibilityLiveRegion="polite" style={{ fontVariant: ['tabular-nums'] }}>{status}</Text>
          </View>
          {hasFilters && <Button variant="ghost" size="sm" haptic="selection" onPress={resetFilters}><Text>Reset</Text></Button>}
        </View>
        {snapshot.error && snapshot.streams.length > 0 && <Text variant="muted">{snapshot.error}</Text>}
        {authError && <Text accessibilityRole="alert" className="text-sm text-destructive">{authError}</Text>}
      </View>}
      renderItem={({ item }) => <StreamCard presentation={getStreamPresentation(item)} label={getSourceLabel(item)}
        filename={item.behaviorHints?.filename} size={item.behaviorHints?.videoSize} disabled={!isSelectableStream(item)}
        selected={selected === item} onSelect={() => select(item)} />}
      ListEmptyComponent={!snapshot.complete && !snapshot.streams.length ? <View className="gap-2">{Array.from({ length: 4 }, (_, i) => <StreamSkeleton key={i} />)}</View>
        : hasFilters ? <EmptyStreams title={snapshot.complete ? 'No matching streams' : 'No matching streams yet'}
          description="Try a different search or filter." action="Clear filters" onAction={resetFilters} />
        : snapshot.complete ? <EmptyStreams title={snapshot.error ? 'Could not load streams' : !snapshot.total ? 'No stream add-ons connected' : 'No streams found'}
          description={snapshot.error ?? (!snapshot.total ? 'Install a stream add-on in Stremio, then try again.' : 'Your add-ons returned no streams for this title.')}
          action="Try again" onAction={reload} /> : null}
      ListFooterComponent={snapshot.signedIn === true && snapshot.complete ? <View className="gap-2 pt-4">
        {snapshot.error && snapshot.streams.length > 0 && <Button variant="secondary" onPress={reload}><Text>Retry add-ons</Text></Button>}
        <Button variant="ghost" loading={authPending} onPress={() => void signOut()}><Text className="text-muted-foreground">Sign out</Text></Button>
      </View> : null}
    />
  );

  return <FloatingSheet ref={sheet} layout={streamSheetLayout(width, height, insets)} blurTarget={blurTarget} onDismiss={dismissed}
    keyboardBehavior="interactive" keyboardBlurBehavior="restore" android_keyboardInputMode="adjustResize" enableBlurKeyboardOnGesture>
    <View testID="stream-selector" accessibilityViewIsModal onAccessibilityEscape={close} accessible={false} style={{ flex: 1 }}>
      <View className="flex-row items-center gap-2 px-4 pb-2">
        {pane !== 'streams' && <Button size="icon" variant="ghost" accessibilityLabel="Back to streams" haptic="selection" onPress={() => setPane('streams')}><Icon as={ArrowLeft} size={20} /></Button>}
        <View className="flex-1 min-w-0">
          <Text testID="stream-selector-title" role="heading" className="text-xl font-nav-semibold">{pane === 'addons' ? 'Add-ons' : pane === 'filters' ? 'Filters' : 'Streams'}</Text>
          {pane === 'streams' && <Text variant="muted" numberOfLines={2}>{title}</Text>}
        </View>
        <Button testID="stream-selector-close" size="icon" variant="ghost" accessibilityLabel="Close streams" haptic="selection" onPress={close}><Icon as={X} size={21} /></Button>
      </View>
      {pane === 'streams' && selected && !onSelect && <View className="mx-4 mb-2 flex-row items-start gap-2 rounded-xl bg-muted px-3 py-2">
        <Icon as={Check} color={theme.primary} size={18} />
        <Text className="flex-1 text-sm" accessibilityLiveRegion="polite">Stream selected. Playback is not connected in this build.</Text>
      </View>}
      {body}
    </View>
  </FloatingSheet>;
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
  search: { minHeight: 48, borderRadius: 14, flexDirection: 'row', alignItems: 'center', paddingStart: 12, gap: 8 },
  searchInput: { flex: 1, minWidth: 0, minHeight: 48, paddingVertical: 0, paddingEnd: 8, fontSize: 16 },
  clear: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  chip: { minHeight: 48, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, flexDirection: 'row', alignItems: 'center', gap: 4 },
});
