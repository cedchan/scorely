import { useEffect } from 'react';
import { Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import UploadScreen from './screens/UploadScreen';
import PlayerScreen from './screens/PlayerScreen';

const Stack = createNativeStackNavigator();

const COLORS = {
  beige: '#FAF7F0',
  lightBrown: '#A9988F',
  darkBrown: '#58392F',
};

export default function App() {
  useEffect(() => {
    if (Platform.OS !== 'web') {
      return undefined;
    }

    const viewportMeta =
      document.querySelector('meta[name="viewport"]') || document.createElement('meta');
    const previousViewport = viewportMeta.getAttribute('content');
    viewportMeta.setAttribute(
      'content',
      'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'
    );
    if (!viewportMeta.parentNode) {
      viewportMeta.setAttribute('name', 'viewport');
      document.head.appendChild(viewportMeta);
    }

    const previousHtmlTouchAction = document.documentElement.style.touchAction;
    const previousBodyTouchAction = document.body.style.touchAction;
    document.documentElement.style.touchAction = 'manipulation';
    document.body.style.touchAction = 'manipulation';
    let lastTouchEndTime = 0;

    const interactionStyle = document.createElement('style');
    interactionStyle.setAttribute('data-scorely-interaction-style', 'true');
    interactionStyle.textContent = `
      html,
      body,
      #root,
      #root *,
      input,
      textarea,
      [contenteditable="true"],
      img,
      svg,
      svg * {
        -webkit-tap-highlight-color: transparent;
        -webkit-touch-callout: none;
        -webkit-user-select: none;
        -moz-user-select: none;
        -ms-user-select: none;
        user-select: none;
      }

      img,
      svg {
        -webkit-user-drag: none;
      }

      html,
      body,
      #root,
      #root * {
        touch-action: manipulation;
      }

      html *::selection,
      html *::-moz-selection {
        background: transparent;
        color: inherit;
      }
    `;
    document.head.appendChild(interactionStyle);

    const preventBrowserZoom = (event) => {
      if ((event.touches && event.touches.length > 1) || event.scale > 1) {
        event.preventDefault();
      }
    };

    const preventDoubleTapZoom = (event) => {
      const now = Date.now();
      if (now - lastTouchEndTime < 300) {
        event.preventDefault();
      }
      lastTouchEndTime = now;
    };

    const clearSelection = () => {
      const selection = window.getSelection?.();
      if (selection && selection.rangeCount > 0) {
        selection.removeAllRanges();
      }
    };

    const preventSelection = (event) => {
      event.preventDefault();
      clearSelection();
    };

    const preventDoubleClickZoom = (event) => {
      event.preventDefault();
      clearSelection();
    };

    document.addEventListener('gesturestart', preventBrowserZoom, { passive: false });
    document.addEventListener('gesturechange', preventBrowserZoom, { passive: false });
    document.addEventListener('gestureend', preventBrowserZoom, { passive: false });
    document.addEventListener('touchmove', preventBrowserZoom, { passive: false });
    document.addEventListener('touchend', preventDoubleTapZoom, { passive: false });
    document.addEventListener('dblclick', preventDoubleClickZoom, { passive: false, capture: true });
    document.addEventListener('selectstart', preventSelection);
    document.addEventListener('dragstart', preventSelection);
    document.addEventListener('selectionchange', clearSelection);

    return () => {
      document.removeEventListener('gesturestart', preventBrowserZoom);
      document.removeEventListener('gesturechange', preventBrowserZoom);
      document.removeEventListener('gestureend', preventBrowserZoom);
      document.removeEventListener('touchmove', preventBrowserZoom);
      document.removeEventListener('touchend', preventDoubleTapZoom);
      document.removeEventListener('dblclick', preventDoubleClickZoom, true);
      document.removeEventListener('selectstart', preventSelection);
      document.removeEventListener('dragstart', preventSelection);
      document.removeEventListener('selectionchange', clearSelection);
      document.documentElement.style.touchAction = previousHtmlTouchAction;
      document.body.style.touchAction = previousBodyTouchAction;
      interactionStyle.remove();

      if (previousViewport) {
        viewportMeta.setAttribute('content', previousViewport);
      } else {
        viewportMeta.removeAttribute('content');
      }
    };
  }, []);

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Upload"
        screenOptions={{
          headerStyle: {
            backgroundColor: COLORS.darkBrown,
          },
          headerTintColor: COLORS.beige,
          headerTitleStyle: {
            fontSize: 20,
          },
        }}
      >
        <Stack.Screen
          name="Upload"
          component={UploadScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Player"
          component={PlayerScreen}
          options={{ headerShown: false }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
