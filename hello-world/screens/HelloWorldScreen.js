import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useFonts, Afacad_400Regular } from '@expo-google-fonts/afacad';

export default function HelloWorldScreen({ navigation }) {
  let [fontsLoaded] = useFonts({
    Afacad_400Regular,
  });

  if (!fontsLoaded) {
    return null;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Hello World</Text>
      <TouchableOpacity
        style={styles.button}
        onPress={() => navigation.navigate('HelloStyles')}
      >
        <Text style={styles.buttonText}>View Styles</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAF7F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 48,
    color: '#58392F',
    marginBottom: 30,
  },
  button: {
    backgroundColor: '#58392F',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 8,
  },
  buttonText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 18,
    color: '#FAF7F0',
  },
});
