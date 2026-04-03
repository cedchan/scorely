import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useFonts, Afacad_400Regular } from '@expo-google-fonts/afacad';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faUpload, faFileMusic } from '@fortawesome/free-solid-svg-icons';
import * as DocumentPicker from 'expo-document-picker';

const COLORS = {
  beige: '#FAF7F0',
  lightBrown: '#A9988F',
  darkBrown: '#58392F',
};

export default function UploadScreen({ navigation }) {
  let [fontsLoaded] = useFonts({
    Afacad_400Regular,
  });

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
      });

      if (!result.canceled) {
        console.log('Document picked:', result);
        // TODO: Upload to backend for transcription
      }
    } catch (err) {
      console.error('Error picking document:', err);
    }
  };

  if (!fontsLoaded) {
    return null;
  }

  return (
    <View style={styles.container}>
      <FontAwesomeIcon icon={faFileMusic} size={80} color={COLORS.lightBrown} />

      <Text style={styles.title}>Upload Sheet Music</Text>
      <Text style={styles.subtitle}>
        Select a PDF file to transcribe and display
      </Text>

      <TouchableOpacity style={styles.uploadButton} onPress={pickDocument}>
        <FontAwesomeIcon icon={faUpload} size={24} color={COLORS.beige} />
        <Text style={styles.uploadButtonText}>Choose PDF File</Text>
      </TouchableOpacity>

      <View style={styles.infoBox}>
        <Text style={styles.infoText}>
          Supported format: PDF{'\n'}
          The file will be processed using OMR technology
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.beige,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 36,
    color: COLORS.darkBrown,
    marginTop: 30,
    marginBottom: 10,
  },
  subtitle: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 18,
    color: COLORS.lightBrown,
    textAlign: 'center',
    marginBottom: 40,
  },
  uploadButton: {
    backgroundColor: COLORS.darkBrown,
    paddingHorizontal: 40,
    paddingVertical: 20,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 30,
  },
  uploadButtonText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 20,
    color: COLORS.beige,
    marginLeft: 15,
  },
  infoBox: {
    backgroundColor: COLORS.lightBrown,
    padding: 20,
    borderRadius: 8,
    marginTop: 20,
  },
  infoText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 14,
    color: COLORS.beige,
    textAlign: 'center',
  },
});
