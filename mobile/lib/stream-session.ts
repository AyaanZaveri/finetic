import { createStreamClient } from './stream-api';

const SESSION_KEY = 'navigator.stremio.session';

async function secureStore() {
  try {
    const store = await import('expo-secure-store');
    if (await store.isAvailableAsync()) return store;
  } catch {
    // Old development clients can still browse without the new native module.
  }
  throw new Error('Secure storage is unavailable. Update the native Navigator app to sign in to Stremio.');
}

export const stremioStreams = createStreamClient({
  async read() {
    const store = await secureStore();
    return store.getItemAsync(SESSION_KEY).catch(() => { throw new Error('Could not read the Stremio session on this device.'); });
  },
  async write(key) {
    const store = await secureStore();
    await store.setItemAsync(SESSION_KEY, key, { keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY })
      .catch(() => { throw new Error('Could not save the Stremio session securely. Try again.'); });
  },
  async clear() {
    const store = await secureStore();
    await store.deleteItemAsync(SESSION_KEY).catch(() => { throw new Error('Could not sign out on this device. Try again.'); });
  },
});
