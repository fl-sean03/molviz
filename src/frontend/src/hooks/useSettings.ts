/**
 * Settings hook for configurable options like backend URL.
 *
 * Priority:
 * 1. URL parameter: ?backend=wss://example.com
 * 2. localStorage: molviz_backend_url
 * 3. Default: ws://localhost:8765
 */

import { useState, useCallback } from 'react';

const STORAGE_KEY = 'molviz_backend_url';
const DEFAULT_URL = 'ws://localhost:8765';

// Known backend presets
export const BACKEND_PRESETS = {
  local: 'ws://localhost:8765',
  cloud: 'wss://87-99-131-239.nip.io',
} as const;

function getInitialBackendUrl(): string {
  // 1. Check URL parameter
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const urlParam = params.get('backend');
    if (urlParam) {
      return urlParam;
    }
  }

  // 2. Check localStorage
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return stored;
    }
  }

  // 3. Default
  return DEFAULT_URL;
}

export interface Settings {
  backendUrl: string;
  setBackendUrl: (url: string) => void;
  resetBackendUrl: () => void;
  isDefaultUrl: boolean;
}

export function useSettings(): Settings {
  const [backendUrl, setBackendUrlState] = useState<string>(getInitialBackendUrl);

  // Persist to localStorage when changed
  const setBackendUrl = useCallback((url: string) => {
    setBackendUrlState(url);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, url);
    }
  }, []);

  // Reset to default
  const resetBackendUrl = useCallback(() => {
    setBackendUrlState(DEFAULT_URL);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const isDefaultUrl = backendUrl === DEFAULT_URL;

  return {
    backendUrl,
    setBackendUrl,
    resetBackendUrl,
    isDefaultUrl,
  };
}
