import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useFonts, Afacad_400Regular } from '@expo-google-fonts/afacad';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import {
  faPlay,
  faPause,
  faForward,
  faBackward,
  faMusic,
} from '@fortawesome/free-solid-svg-icons';

const COLORS = {
  beige: '#FAF7F0',
  lightBrown: '#A9988F',
  darkBrown: '#58392F',
};

export default function PlayerScreen({ navigation }) {
  let [fontsLoaded] = useFonts({
    Afacad_400Regular,
  });

  if (!fontsLoaded) {
    return null;
  }

  return (
    <View style={styles.container}>
      {/* Score Display Area */}
      <ScrollView style={styles.scoreContainer}>
        <View style={styles.scorePlaceholder}>
          <FontAwesomeIcon icon={faMusic} size={60} color={COLORS.lightBrown} />
          <Text style={styles.placeholderText}>
            Musical score will be displayed here
          </Text>
          <Text style={styles.placeholderSubtext}>
            Upload a PDF to get started
          </Text>
        </View>
      </ScrollView>

      {/* Playback Controls */}
      <View style={styles.controlsContainer}>
        <Text style={styles.controlsTitle}>Playback Controls</Text>

        <View style={styles.controls}>
          <TouchableOpacity style={styles.controlButton}>
            <FontAwesomeIcon icon={faBackward} size={28} color={COLORS.darkBrown} />
          </TouchableOpacity>

          <TouchableOpacity style={[styles.controlButton, styles.playButton]}>
            <FontAwesomeIcon icon={faPlay} size={32} color={COLORS.beige} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.controlButton}>
            <FontAwesomeIcon icon={faForward} size={28} color={COLORS.darkBrown} />
          </TouchableOpacity>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoText}>Tempo: 120 BPM</Text>
          <Text style={styles.infoText}>Time: 0:00 / 0:00</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.beige,
  },
  scoreContainer: {
    flex: 1,
    padding: 20,
  },
  scorePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 100,
  },
  placeholderText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 24,
    color: COLORS.darkBrown,
    marginTop: 20,
    textAlign: 'center',
  },
  placeholderSubtext: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 16,
    color: COLORS.lightBrown,
    marginTop: 10,
    textAlign: 'center',
  },
  controlsContainer: {
    backgroundColor: COLORS.lightBrown,
    padding: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  controlsTitle: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 18,
    color: COLORS.beige,
    textAlign: 'center',
    marginBottom: 15,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  controlButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.beige,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 15,
  },
  playButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.darkBrown,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  infoText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 14,
    color: COLORS.beige,
  },
});
