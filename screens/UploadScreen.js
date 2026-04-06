import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Alert,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useFonts, Afacad_400Regular } from '@expo-google-fonts/afacad';
import Constants from 'expo-constants';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faCheckCircle, faClock, faMusic, faUpload, faUserPlus } from '@fortawesome/free-solid-svg-icons';
import * as DocumentPicker from 'expo-document-picker';

const COLORS = {
  background: '#F7F1E8',
  card: '#FFFDF8',
  stroke: '#E3D5C2',
  muted: '#A9988F',
  primary: '#58392F',
  accent: '#D8DCC8',
  accentSoft: '#F3F4EC',
  success: '#4E8B62',
  paperShadow: 'rgba(88, 57, 47, 0.08)',
};

const DEFAULT_PROJECTS = [
  {
    id: 'project-upload',
    title: 'Upload New Piece',
    icon: faUpload,
    subtitle: null,
    tone: 'neutral',
    action: 'upload',
  },
  {
    id: 'project-join',
    title: 'Join Shared Score',
    icon: faUserPlus,
    subtitle: 'Enter a share code',
    tone: 'neutral',
    action: 'join',
  },
  {
    id: 'project-demo-1',
    title: 'Demo Score 1',
    subtitle: null,
    icon: faMusic,
    tone: 'neutral',
    action: 'open',
    jobId: '8f8216e9-6030-41ce-a5c9-a84f1b4734fc',
    musicxmlPath: '/api/download/8f8216e9-6030-41ce-a5c9-a84f1b4734fc/8f8216e9-6030-41ce-a5c9-a84f1b4734fc.mxl',
    pageManifestPath: '/api/score-pages/8f8216e9-6030-41ce-a5c9-a84f1b4734fc',
  },
  {
    id: 'project-demo-2',
    title: 'Demo Score 2',
    subtitle: null,
    icon: faMusic,
    tone: 'neutral',
    action: 'open',
    jobId: '8f8216e9-6030-41ce-a5c9-a84f1b4734fc',
    musicxmlPath: '/api/download/8f8216e9-6030-41ce-a5c9-a84f1b4734fc/8f8216e9-6030-41ce-a5c9-a84f1b4734fc.mxl',
    pageManifestPath: '/api/score-pages/8f8216e9-6030-41ce-a5c9-a84f1b4734fc',
  },
  {
    id: 'project-demo-3',
    title: 'Demo Score 3',
    subtitle: null,
    icon: faMusic,
    tone: 'neutral',
    action: 'open',
    jobId: '8f8216e9-6030-41ce-a5c9-a84f1b4734fc',
    musicxmlPath: '/api/download/8f8216e9-6030-41ce-a5c9-a84f1b4734fc/8f8216e9-6030-41ce-a5c9-a84f1b4734fc.mxl',
    pageManifestPath: '/api/score-pages/8f8216e9-6030-41ce-a5c9-a84f1b4734fc',
  },
];

const getApiBaseUrl = () => {
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:8000';
  }

  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.location?.hostname) {
      const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
      return `${protocol}//${window.location.hostname}:8000`;
    }
    return 'http://localhost:8000';
  }

  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.expoGoConfig?.debuggerHost ||
    Constants.manifest2?.extra?.expoGo?.debuggerHost;

  if (hostUri) {
    const host = hostUri.split(':')[0];
    return `http://${host}:8000`;
  }

  return 'http://localhost:8000';
};

export default function UploadScreen({ navigation }) {
  const { width, height } = useWindowDimensions();
  const apiBaseUrl = getApiBaseUrl();
  const [selectedFile, setSelectedFile] = useState(null);
  const [statusText, setStatusText] = useState('Choose a piece to start transcription.');
  const [isLoading, setIsLoading] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [latestProject, setLatestProject] = useState(null);
  const pollTimerRef = useRef(null);
  const scrollX = useRef(new Animated.Value(0)).current;

  const [fontsLoaded] = useFonts({
    Afacad_400Regular,
  });

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
      }
    };
  }, []);

  // Refresh latest project when screen comes into focus
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', async () => {
      // Refresh the latest project's title if it exists
      if (latestProject?.jobId && latestProject?.pageManifestPath) {
        try {
          const response = await fetch(`${apiBaseUrl}${latestProject.pageManifestPath}`);
          const data = await response.json();

          if (response.ok && data.title) {
            setLatestProject((prev) => ({
              ...prev,
              title: data.title,
            }));
          }
        } catch (error) {
          console.error('Failed to refresh project title:', error);
        }
      }
    });

    return unsubscribe;
  }, [navigation, latestProject?.jobId, latestProject?.pageManifestPath, apiBaseUrl]);

  const clearPollTimer = () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const goToRenderedScore = (job, nextJobId, fileName) => {
    navigation.push('Player', {
      apiBaseUrl,
      jobId: nextJobId,
      musicxmlPath: job.files.musicxml,
      pageManifestPath: job.files.score_pages,
      fileName,
    });
  };

  const joinSharedScore = async () => {
    const code = prompt('Enter 6-character share code:');
    if (!code) return;

    try {
      const response = await fetch(`${apiBaseUrl}/api/resolve-code/${code.toUpperCase()}`);
      const data = await response.json();

      if (response.ok) {
        navigation.push('Player', {
          apiBaseUrl,
          jobId: data.job_id,
          musicxmlPath: data.files.musicxml,
          pageManifestPath: data.files.score_pages,
          fileName: data.title || 'Shared Score',
        });
      } else {
        Alert.alert('Invalid Code', data.detail || 'The share code you entered is invalid or expired.');
      }
    } catch (error) {
      Alert.alert('Connection Error', `Failed to resolve share code: ${error.message}`);
    }
  };

  const openProject = (project) => {
    if (project.action === 'upload') {
      pickDocument();
      return;
    }

    if (project.action === 'join') {
      joinSharedScore();
      return;
    }

    if (project.action === 'open' && project.jobId && project.pageManifestPath) {
      navigation.push('Player', {
        apiBaseUrl,
        jobId: project.jobId,
        musicxmlPath: project.musicxmlPath,
        pageManifestPath: project.pageManifestPath,
        fileName: project.title,
      });
      return;
    }

    Alert.alert('No Score Yet', 'Upload a PDF to create your first score project.');
  };

  const pollJobStatus = async (nextJobId, fileName) => {
    try {
      const response = await fetch(`${apiBaseUrl}/api/status/${nextJobId}`);
      const job = await response.json();

      if (!response.ok) {
        throw new Error(job.detail || 'Failed to check transcription status.');
      }

      const transcriptionDone = job.progress?.transcription === 'completed';
      setStatusText(
        transcriptionDone
          ? 'Transcription finished. Preparing readable pages...'
          : 'Transcribing the uploaded PDF into MusicXML...'
      );

      if (job.error || job.status === 'failed') {
        throw new Error(job.error || 'Transcription failed.');
      }

      if (transcriptionDone && job.files?.score_pages) {
        clearPollTimer();
        setIsLoading(false);
        setLatestProject({
          id: `project-${nextJobId}`,
          title: fileName,
          subtitle: null,
          icon: faMusic,
          tone: 'neutral',
          action: 'open',
          jobId: nextJobId,
          musicxmlPath: job.files.musicxml,
          pageManifestPath: job.files.score_pages,
        });
        goToRenderedScore(job, nextJobId, fileName);
        return;
      }

      pollTimerRef.current = setTimeout(() => {
        pollJobStatus(nextJobId, fileName);
      }, 2000);
    } catch (error) {
      clearPollTimer();
      setIsLoading(false);
      setStatusText('We could not complete transcription.');
      Alert.alert('Transcription Error', error.message);
    }
  };

  const uploadPdf = async (fileAsset) => {
    const formData = new FormData();
    const isMusicXML = fileAsset.name?.toLowerCase().endsWith('.mxl') ||
                       fileAsset.name?.toLowerCase().endsWith('.musicxml');

    if (Platform.OS === 'web' && fileAsset.file) {
      formData.append('file', fileAsset.file, fileAsset.name || 'score.pdf');
    } else {
      formData.append('file', {
        uri: fileAsset.uri,
        name: fileAsset.name || 'score.pdf',
        type: fileAsset.mimeType || (isMusicXML ? 'application/vnd.recordare.musicxml+xml' : 'application/pdf'),
      });
    }

    setIsLoading(true);
    setStatusText(isMusicXML ? 'Uploading MusicXML to the backend...' : 'Uploading PDF to the backend...');

    try {
      const response = await fetch(`${apiBaseUrl}/api/transcribe`, {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Upload failed.');
      }

      setJobId(data.job_id);
      setStatusText(isMusicXML ? 'Processing MusicXML file...' : 'Upload complete. Waiting for transcription...');
      pollJobStatus(data.job_id, fileAsset.name || 'Uploaded score');
    } catch (error) {
      setIsLoading(false);
      setStatusText('Upload failed.');
      Alert.alert(
        'Upload Error',
        `${error.message}\n\nMake sure the backend is running at ${apiBaseUrl}.`
      );
    }
  };

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        base64: false,
        copyToCacheDirectory: true,
        type: Platform.OS === 'web'
          ? ['application/pdf', '.mxl', '.musicxml']  // Web accepts extensions
          : '*/*',  // Native lets us filter afterward
      });

      if (result.canceled) {
        return;
      }

      const fileAsset = result.assets[0];

      // Validate file type
      const validExtensions = ['.pdf', '.mxl', '.musicxml'];
      const hasValidExtension = validExtensions.some(ext =>
        fileAsset.name?.toLowerCase().endsWith(ext)
      );

      if (!hasValidExtension) {
        Alert.alert('Invalid File', 'Please select a PDF or MusicXML (.mxl) file.');
        return;
      }

      setSelectedFile(fileAsset);
      clearPollTimer();
      uploadPdf(fileAsset);
    } catch (err) {
      Alert.alert('Picker Error', 'There was a problem choosing your file.');
    }
  };

  const projects = useMemo(() => {
    if (!latestProject) {
      return DEFAULT_PROJECTS;
    }

    return [DEFAULT_PROJECTS[0], DEFAULT_PROJECTS[1], latestProject, DEFAULT_PROJECTS[2], DEFAULT_PROJECTS[3]];
  }, [latestProject]);
  const pagePadding = width >= 768 ? 24 : 20;
  const projectGap = width >= 768 ? 18 : 14;
  const projectAspectRatio = 8.5 / 11;
  const projectCardWidth = width >= 1024 ? 250 : width >= 768 ? 220 : 170;
  const projectCardHeight = projectCardWidth / projectAspectRatio;
  const maxScale = 1.08;
  const snapInterval = projectCardWidth * maxScale + projectGap;
  const carouselSidePadding = Math.max(0, (width - projectCardWidth * maxScale) / 2);
  const carouselHeight = projectCardHeight + 40;

  if (!fontsLoaded) {
    return null;
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingHorizontal: pagePadding, paddingVertical: pagePadding }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Text style={styles.brand}>Scorely</Text>
          <Text style={styles.heroTitle}>Your rehearsal library, ready to open and play.</Text>
          <Text style={styles.heroSubtitle}>
            Upload a PDF, transcribe it into MusicXML, and open a clean paginated score from any
            device on your local setup.
          </Text>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Library</Text>
          <Text style={styles.sectionCopy}>
            Tap a paper tile to open a score or start a new transcription.
          </Text>
        </View>

        <View style={[styles.carouselSection, { minHeight: carouselHeight + 36 }]}>
          <Animated.ScrollView
            horizontal
            decelerationRate="fast"
            snapToInterval={snapInterval}
            disableIntervalMomentum
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[
              styles.projectCarousel,
              {
                paddingLeft: carouselSidePadding,
                paddingRight: Math.max(0, carouselSidePadding - projectGap),
              },
            ]}
            onScroll={Animated.event(
              [{ nativeEvent: { contentOffset: { x: scrollX } } }],
              { useNativeDriver: true }
            )}
            scrollEventThrottle={16}
          >
            {projects.map((project, index) => {
              const inputRange = [
                (index - 1) * snapInterval,
                index * snapInterval,
                (index + 1) * snapInterval,
              ];
              const scale = scrollX.interpolate({
                inputRange,
                outputRange: [0.8, 1.08, 0.8],
                extrapolate: 'clamp',
              });
              const translateY = scrollX.interpolate({
                inputRange,
                outputRange: [18, 0, 18],
                extrapolate: 'clamp',
              });
              const opacity = scrollX.interpolate({
                inputRange,
                outputRange: [0.62, 1, 0.62],
                extrapolate: 'clamp',
              });

            return (
              <Animated.View
                key={project.id}
                style={[
                  styles.projectCardWrap,
                  {
                    width: projectCardWidth,
                    height: carouselHeight,
                    marginRight: projectGap,
                    transform: [{ translateY }, { scale }],
                    opacity,
                  },
                ]}
              >
                <TouchableOpacity
                  style={[styles.projectCard, { width: projectCardWidth, height: projectCardHeight }]}
                  onPress={() => openProject(project)}
                  activeOpacity={0.9}
                >
                  <View style={styles.projectIconWrap}>
                    <FontAwesomeIcon
                      icon={project.icon}
                      size={22}
                      color={COLORS.primary}
                    />
                  </View>
                  <Text style={styles.projectTitle}>{project.title}</Text>
                  {project.subtitle ? <Text style={styles.projectSubtitle}>{project.subtitle}</Text> : null}
                </TouchableOpacity>
              </Animated.View>
            );
            })}
          </Animated.ScrollView>
        </View>

        <View style={styles.statusCard}>
          <View style={styles.statusHeader}>
            <View style={styles.statusRow}>
              <FontAwesomeIcon
                icon={selectedFile ? faCheckCircle : faClock}
                size={18}
                color={COLORS.primary}
              />
              <Text style={styles.statusLabel}>
                {selectedFile ? `Selected file: ${selectedFile.name}` : 'Supported formats: PDF, MXL'}
              </Text>
            </View>
            {isLoading ? <ActivityIndicator color={COLORS.primary} /> : null}
          </View>

          <Text style={styles.statusText}>{statusText}</Text>
          {jobId ? <Text style={styles.jobText}>Job ID: {jobId}</Text> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
  },
  hero: {
    marginBottom: 28,
  },
  brand: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 40,
    color: COLORS.primary,
    marginBottom: 10,
  },
  heroTitle: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 28,
    lineHeight: 32,
    color: COLORS.primary,
    marginBottom: 10,
    maxWidth: 720,
  },
  heroSubtitle: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 18,
    lineHeight: 24,
    color: COLORS.muted,
    maxWidth: 760,
  },
  sectionHeader: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 24,
    color: COLORS.primary,
    marginBottom: 4,
  },
  sectionCopy: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 17,
    color: COLORS.muted,
  },
  carouselSection: {
    justifyContent: 'center',
    marginBottom: 12,
  },
  projectCarousel: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 16,
  },
  projectCardWrap: {
    justifyContent: 'center',
  },
  projectCard: {
    backgroundColor: COLORS.card,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    justifyContent: 'flex-start',
    shadowColor: COLORS.primary,
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
  },
  projectIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#F2E8DA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  projectTitle: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 20,
    color: COLORS.primary,
    marginTop: 14,
  },
  projectSubtitle: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 15,
    lineHeight: 20,
    color: COLORS.muted,
    marginTop: 8,
  },
  statusCard: {
    backgroundColor: COLORS.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    padding: 18,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusLabel: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 17,
    color: COLORS.primary,
    marginLeft: 10,
  },
  statusText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 17,
    color: COLORS.muted,
    lineHeight: 22,
  },
  jobText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 14,
    color: COLORS.muted,
    marginTop: 10,
  },
});
