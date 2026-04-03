import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useFonts, Afacad_400Regular } from '@expo-google-fonts/afacad';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import {
  faMusic,
  faGuitar,
  faDrum,
  faHeadphones,
  faHeart,
  faStar,
  faPlay,
  faPause,
  faForward,
  faBackward,
} from '@fortawesome/free-solid-svg-icons';

const COLORS = {
  beige: '#FAF7F0',
  lightBrown: '#A9988F',
  darkBrown: '#58392F',
};

export default function App() {
  let [fontsLoaded] = useFonts({
    Afacad_400Regular,
  });

  if (!fontsLoaded) {
    return null;
  }

  return (
    <ScrollView style={styles.scrollContainer}>
      <View style={styles.container}>
        {/* Hello World Section */}
        <Text style={styles.mainTitle}>Hello World</Text>
        <Text style={styles.subtitle}>Style Guide Demo</Text>

        {/* Colors Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Colors</Text>

          <View style={styles.colorRow}>
            <View style={[styles.colorBox, { backgroundColor: COLORS.beige }]}>
              <Text style={[styles.colorLabel, { color: COLORS.darkBrown }]}>Beige</Text>
              <Text style={[styles.colorHex, { color: COLORS.darkBrown }]}>#FAF7F0</Text>
            </View>

            <View style={[styles.colorBox, { backgroundColor: COLORS.lightBrown }]}>
              <Text style={[styles.colorLabel, { color: COLORS.beige }]}>Light Brown</Text>
              <Text style={[styles.colorHex, { color: COLORS.beige }]}>#A9988F</Text>
            </View>

            <View style={[styles.colorBox, { backgroundColor: COLORS.darkBrown }]}>
              <Text style={[styles.colorLabel, { color: COLORS.beige }]}>Dark Brown</Text>
              <Text style={[styles.colorHex, { color: COLORS.beige }]}>#58392F</Text>
            </View>
          </View>
        </View>

        {/* Typography Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Typography - Afacad Regular</Text>

          <Text style={[styles.text, { fontSize: 32 }]}>
            Large Heading (32px)
          </Text>
          <Text style={[styles.text, { fontSize: 24 }]}>
            Medium Heading (24px)
          </Text>
          <Text style={[styles.text, { fontSize: 18 }]}>
            Body Text (18px)
          </Text>
          <Text style={[styles.text, { fontSize: 14 }]}>
            Small Text (14px)
          </Text>
          <Text style={[styles.text, { fontSize: 16, marginTop: 15 }]}>
            The quick brown fox jumps over the lazy dog. This paragraph demonstrates
            the Afacad font family in regular weight with standard body text sizing.
          </Text>
        </View>

        {/* Icons Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>FontAwesome Icons</Text>

          <View style={styles.iconGrid}>
            <View style={styles.iconItem}>
              <FontAwesomeIcon icon={faMusic} size={32} color={COLORS.darkBrown} />
              <Text style={styles.iconLabel}>Music</Text>
            </View>

            <View style={styles.iconItem}>
              <FontAwesomeIcon icon={faGuitar} size={32} color={COLORS.darkBrown} />
              <Text style={styles.iconLabel}>Guitar</Text>
            </View>

            <View style={styles.iconItem}>
              <FontAwesomeIcon icon={faDrum} size={32} color={COLORS.darkBrown} />
              <Text style={styles.iconLabel}>Drum</Text>
            </View>

            <View style={styles.iconItem}>
              <FontAwesomeIcon icon={faHeadphones} size={32} color={COLORS.darkBrown} />
              <Text style={styles.iconLabel}>Headphones</Text>
            </View>

            <View style={styles.iconItem}>
              <FontAwesomeIcon icon={faHeart} size={32} color={COLORS.darkBrown} />
              <Text style={styles.iconLabel}>Heart</Text>
            </View>

            <View style={styles.iconItem}>
              <FontAwesomeIcon icon={faStar} size={32} color={COLORS.darkBrown} />
              <Text style={styles.iconLabel}>Star</Text>
            </View>

            <View style={styles.iconItem}>
              <FontAwesomeIcon icon={faPlay} size={32} color={COLORS.darkBrown} />
              <Text style={styles.iconLabel}>Play</Text>
            </View>

            <View style={styles.iconItem}>
              <FontAwesomeIcon icon={faPause} size={32} color={COLORS.darkBrown} />
              <Text style={styles.iconLabel}>Pause</Text>
            </View>

            <View style={styles.iconItem}>
              <FontAwesomeIcon icon={faForward} size={32} color={COLORS.darkBrown} />
              <Text style={styles.iconLabel}>Forward</Text>
            </View>

            <View style={styles.iconItem}>
              <FontAwesomeIcon icon={faBackward} size={32} color={COLORS.darkBrown} />
              <Text style={styles.iconLabel}>Backward</Text>
            </View>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContainer: {
    flex: 1,
    backgroundColor: COLORS.beige,
  },
  container: {
    padding: 20,
    paddingTop: 60,
    paddingBottom: 40,
  },
  mainTitle: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 48,
    color: COLORS.darkBrown,
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 24,
    color: COLORS.lightBrown,
    textAlign: 'center',
    marginBottom: 40,
  },
  section: {
    marginBottom: 40,
  },
  sectionTitle: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 24,
    color: COLORS.darkBrown,
    marginBottom: 20,
  },
  colorRow: {
    flexDirection: 'column',
  },
  colorBox: {
    padding: 30,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 100,
    marginBottom: 15,
  },
  colorLabel: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 20,
    marginBottom: 5,
  },
  colorHex: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 16,
  },
  text: {
    fontFamily: 'Afacad_400Regular',
    color: COLORS.darkBrown,
    marginBottom: 10,
  },
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
  },
  iconItem: {
    alignItems: 'center',
    width: '30%',
    marginBottom: 20,
  },
  iconLabel: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 14,
    color: COLORS.darkBrown,
    marginTop: 8,
    textAlign: 'center',
  },
});
