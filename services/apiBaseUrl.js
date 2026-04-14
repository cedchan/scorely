import { Platform } from 'react-native';
import Constants from 'expo-constants';

// Use HTTPS by default for better security and iPad camera access
const DEFAULT_API_BASE_URL = 'https://localhost:8443';

const normalizeUrl = (url) => url.replace(/\/+$/, '');

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
      return `${protocol}//${window.location.hostname}`;
    }
    // Fallback to direct API port for HTTP access
    return `${protocol}//${window.location.hostname}:8443`;
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

  // For iOS/iPad, use HTTPS with the local network IP
  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.expoGoConfig?.debuggerHost ||
    Constants.manifest2?.extra?.expoGo?.debuggerHost;

  if (hostUri) {
    const host = hostUri.split(':')[0];
    return `https://${host}:8443`;
  }

  return DEFAULT_API_BASE_URL;
};
