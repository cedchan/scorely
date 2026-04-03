import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFonts, Afacad_400Regular } from '@expo-google-fonts/afacad';
import Constants from 'expo-constants';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import {
  faCheckCircle,
  faClock,
  faFileMusic,
  faUpload,
} from '@fortawesome/free-solid-svg-icons';
import * as DocumentPicker from 'expo-document-picker';

const COLORS = {
  beige: '#FAF7F0',
  lightBrown: '#A9988F',
  darkBrown: '#58392F',
};

const getApiBaseUrl = () => {
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:8000';
  }

  if (Platform.OS === 'web') {
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
  const apiBaseUrl = getApiBaseUrl();
  const [selectedFile, setSelectedFile] = useState(null);
  const [statusText, setStatusText] = useState('Pick a PDF to start transcription.');
  const [isLoading, setIsLoading] = useState(false);
  const [jobId, setJobId] = useState(null);
  const pollTimerRef = useRef(null);

  let [fontsLoaded] = useFonts({
    Afacad_400Regular,
  });

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
      }
    };
  }, []);

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

  const openRenderedMxlDemo = () => {
    navigation.push('Player', {
      apiBaseUrl,
      jobId: 'take-me-to-church',
      musicxmlPath: '/api/download/take-me-to-church.mxl',
      pageManifestPath: '/api/score-pages/take-me-to-church',
      fileName: 'Take Me To Church - TW1',
    });
  };

  const openYouAndIDemo = () => {
    navigation.push('Player', {
      apiBaseUrl,
      jobId: 'you-and-i',
      musicxmlPath: '/api/download/you-and-i.mxl',
      pageManifestPath: '/api/score-pages/you-and-i',
      fileName: 'You and I',
    });
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
    if (Platform.OS === 'web' && fileAsset.file) {
      formData.append('file', fileAsset.file, fileAsset.name || 'score.pdf');
    } else {
      formData.append('file', {
        uri: fileAsset.uri,
        name: fileAsset.name || 'score.pdf',
        type: fileAsset.mimeType || 'application/pdf',
      });
    }

    setIsLoading(true);
    setStatusText('Uploading PDF to the backend...');

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
      setStatusText('Upload complete. Waiting for transcription...');
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
        type: 'application/pdf',
      });

      if (result.canceled) {
        return;
      }

      const fileAsset = result.assets[0];
      setSelectedFile(fileAsset);
      clearPollTimer();
      uploadPdf(fileAsset);
    } catch (err) {
      Alert.alert('Picker Error', 'There was a problem choosing your PDF.');
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
        Upload a PDF, let the backend transcribe it into MusicXML, and open a paginated digital
        score view.
      </Text>

      <TouchableOpacity
        style={[styles.uploadButton, isLoading && styles.uploadButtonDisabled]}
        onPress={pickDocument}
        disabled={isLoading}
      >
        {isLoading ? (
          <ActivityIndicator color={COLORS.beige} />
        ) : (
          <FontAwesomeIcon icon={faUpload} size={24} color={COLORS.beige} />
        )}
        <Text style={styles.uploadButtonText}>
          {isLoading ? 'Processing Score...' : 'Choose PDF File'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.demoButton}
        onPress={openRenderedMxlDemo}
      >
        <FontAwesomeIcon icon={faFileMusic} size={22} color={COLORS.darkBrown} />
        <Text style={styles.demoButtonText}>Open Rendered MXL Demo</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.demoButton}
        onPress={openYouAndIDemo}
      >
        <FontAwesomeIcon icon={faFileMusic} size={22} color={COLORS.darkBrown} />
        <Text style={styles.demoButtonText}>Open You and I Demo</Text>
      </TouchableOpacity>

      <View style={styles.infoBox}>
        <View style={styles.statusRow}>
          <FontAwesomeIcon
            icon={selectedFile ? faCheckCircle : faClock}
            size={18}
            color={COLORS.beige}
          />
          <Text style={styles.infoText}>
            {selectedFile ? `Selected file: ${selectedFile.name}` : 'Supported format: PDF'}
          </Text>
        </View>

        <Text style={styles.infoText}>{statusText}</Text>
        {jobId ? <Text style={styles.jobText}>Job ID: {jobId}</Text> : null}
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
    maxWidth: 700,
  },
  uploadButton: {
    backgroundColor: COLORS.darkBrown,
    paddingHorizontal: 40,
    paddingVertical: 20,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 30,
    minWidth: 280,
    justifyContent: 'center',
  },
  uploadButtonDisabled: {
    opacity: 0.85,
  },
  uploadButtonText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 20,
    color: COLORS.beige,
    marginLeft: 15,
  },
  demoButton: {
    backgroundColor: '#EADFD2',
    paddingHorizontal: 34,
    paddingVertical: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  demoButtonText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 19,
    color: COLORS.darkBrown,
    marginLeft: 12,
  },
  infoBox: {
    backgroundColor: COLORS.lightBrown,
    padding: 20,
    borderRadius: 8,
    marginTop: 20,
    width: '80%',
    maxWidth: 760,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  infoText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 16,
    color: COLORS.beige,
    textAlign: 'center',
  },
  jobText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 14,
    color: COLORS.beige,
    textAlign: 'center',
    marginTop: 10,
  },
});
