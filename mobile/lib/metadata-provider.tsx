import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';

export type MetadataProvider = 'cinemeta' | 'tmdb';

const STORAGE_KEY = 'navigator.metadata-provider';
const Context = createContext<{ provider: MetadataProvider; setProvider: (provider: MetadataProvider) => void }>({
  provider: 'cinemeta', setProvider: () => {},
});

export function MetadataProviderRoot({ children }: PropsWithChildren) {
  const [provider, setChoice] = useState<MetadataProvider>('cinemeta');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(STORAGE_KEY).then(value => {
      if (active && (value === 'cinemeta' || value === 'tmdb')) setChoice(value);
    }).catch(() => {}).finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);
  const setProvider = (value: MetadataProvider) => {
    setChoice(value);
    void AsyncStorage.setItem(STORAGE_KEY, value).catch(() => {});
  };
  return <Context.Provider value={{ provider, setProvider }}>{ready ? children : null}</Context.Provider>;
}

export const useMetadataProvider = () => useContext(Context);
