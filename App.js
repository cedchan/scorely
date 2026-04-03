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
          options={{ title: 'Music Player' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
