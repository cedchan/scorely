import { Platform } from 'react-native';
import Constants from 'expo-constants';

const DEFAULT_API_BASE_URL = 'http://localhost:8000';

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
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    return `${protocol}//${window.location.hostname}:8000`;
  }

  return DEFAULT_API_BASE_URL;
};

export const getApiBaseUrl = () => {
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:8000';
  }

  if (Platform.OS === 'web') {
    return getWebApiBaseUrl();
  }

  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.expoGoConfig?.debuggerHost ||
    Constants.manifest2?.extra?.expoGo?.debuggerHost;

  if (hostUri) {
    const host = hostUri.split(':')[0];
    return `http://${host}:8000`;
  }

  return DEFAULT_API_BASE_URL;
};
