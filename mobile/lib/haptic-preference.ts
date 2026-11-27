type PreferenceStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

const STORAGE_KEY = 'navigator.haptics.enabled';

/** A small persisted setting. Writes stay ordered so fast toggles cannot
 * leave an obsolete preference on disk. */
export function createHapticPreference(storage: PreferenceStorage) {
  let enabled = true;
  let revision = 0;
  let hydration: Promise<void> | undefined;
  let writes = Promise.resolve();
  const listeners = new Set<() => void>();

  const notify = () => listeners.forEach(listener => listener());
  return {
    getSnapshot: () => enabled,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    hydrate() {
      if (!hydration) {
        const before = revision;
        hydration = storage.getItem(STORAGE_KEY).then(value => {
          if (revision !== before || (value !== '0' && value !== '1')) return;
          const next = value === '1';
          if (next !== enabled) { enabled = next; notify(); }
        }).catch(() => {});
      }
      return hydration;
    },
    setEnabled(next: boolean) {
      revision++;
      if (next !== enabled) { enabled = next; notify(); }
      writes = writes.then(() => storage.setItem(STORAGE_KEY, next ? '1' : '0')).catch(() => {});
      return writes;
    },
  };
}
