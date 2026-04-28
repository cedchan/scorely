import { Platform } from 'react-native';
import Constants from 'expo-constants';

// Use HTTPS by default for better security and iPad camera access
const DEFAULT_API_BASE_URL = 'https://localhost:8443';
const EXPO_PUBLIC_API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

const normalizeUrl = (url) => url.replace(/\/+$/, '');

const extractHost = (value) => {
  if (!value) {
    return null;
  }

  try {
    const normalized = value.includes('://') ? value : `exp://${value}`;
    return new URL(normalized).hostname || null;
  } catch {
    return value.split('/')[0].split(':')[0] || null;
  }
};

const getConfiguredApiBaseUrl = () => {
  if (EXPO_PUBLIC_API_BASE_URL) {
    return normalizeUrl(EXPO_PUBLIC_API_BASE_URL);
  }

  const manifestOverride = Constants.expoConfig?.extra?.apiBaseUrl;
  if (manifestOverride) {
    return normalizeUrl(manifestOverride);
  }

  return null;
};

const getWebApiBaseUrl = () => {
  if (typeof window === 'undefined') {
    return DEFAULT_API_BASE_URL;
  }

  const params = new URLSearchParams(window.location.search);
  const override = params.get('apiBaseUrl') || params.get('api');

  if (override) {
    try {
      return normalizeUrl(new URL(override, window.location.href).toString());
    } catch {
      return normalizeUrl(override);
    }
  }

  if (window.location?.hostname) {
    // Use same origin with /api path when accessed via HTTPS (nginx proxy)
    // This allows single certificate acceptance
    const protocol = window.location.protocol;
    if (protocol === 'https:') {
      // If on standard HTTPS port (443), use hostname only, otherwise use 8443
      const port = window.location.port;
      if (port && port !== '443') {
        return `${protocol}//${window.location.hostname}`;
      }
      return `${protocol}//${window.location.hostname}`;
    }
    // For HTTP access (dev), use HTTPS API port
    return `https://${window.location.hostname}:8443`;
  }

  return DEFAULT_API_BASE_URL;
};

export const getApiBaseUrl = () => {
  if (Platform.OS === 'android') {
    // Android emulator uses 10.0.2.2 for localhost, keep HTTP for emulator compatibility
    return 'http://10.0.2.2:8000';
  }

  if (Platform.OS === 'web') {
    return getWebApiBaseUrl();
  }

  const configured = getConfiguredApiBaseUrl();
  if (configured) {
    return configured;
  }

  // For iOS/iPad, use HTTPS with the local network IP
  const host =
    extractHost(
      Constants.expoConfig?.hostUri ||
      Constants.expoGoConfig?.debuggerHost ||
      Constants.manifest2?.extra?.expoGo?.debuggerHost
    ) ||
    extractHost(Constants.linkingUri) ||
    extractHost(Constants.experienceUrl);

  if (host) {
    return `https://${host}:8443`;
  }

  return DEFAULT_API_BASE_URL;
};
