import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HelloWorldScreen from './screens/HelloWorldScreen';
import HelloStylesScreen from './screens/HelloStylesScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="HelloWorld"
        screenOptions={{
          headerStyle: {
            backgroundColor: '#58392F',
          },
          headerTintColor: '#FAF7F0',
          headerTitleStyle: {
            fontSize: 20,
          },
        }}
      >
        <Stack.Screen
          name="HelloWorld"
          component={HelloWorldScreen}
          options={{ title: 'Hello World' }}
        />
        <Stack.Screen
          name="HelloStyles"
          component={HelloStylesScreen}
          options={{ title: 'Style Guide' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
