import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useFonts, Afacad_400Regular } from '@expo-google-fonts/afacad';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import {
  faBars,
  faFileMusic,
  faGrip,
  faMagnifyingGlass,
  faMusic,
  faUpload,
  faUserPlus,
} from '@fortawesome/free-solid-svg-icons';
import * as DocumentPicker from 'expo-document-picker';
import { getApiBaseUrl } from '../services/apiBaseUrl';

const COLORS = {
  background: '#F7F1E8',
  card: '#FFFDF8',
  cardSoft: '#FBF7F0',
  stroke: '#E3D5C2',
  muted: '#A9988F',
  primary: '#58392F',
  accent: '#D8DCC8',
  accentSoft: '#F3F4EC',
  success: '#4E8B62',
};

const DEFAULT_PROJECTS = [
  {
    id: 'project-upload',
    title: 'Upload new piece',
    icon: faUpload,
    subtitle: 'Import a PDF and start a new transcription',
    action: 'upload',
    kind: 'action',
    updatedAt: 'Start here',
  },
  {
    id: 'project-join',
    title: 'Join shared score',
    icon: faUserPlus,
    subtitle: 'Open a score with a share code',
    action: 'join',
    kind: 'action',
    updatedAt: 'Collaborative',
  },
  {
    id: 'project-empty-1',
    title: 'Untitled Score',
    subtitle: '',
    icon: faFileMusic,
    action: 'placeholder',
    kind: 'score',
    updatedAt: 'Empty',
  },
  {
    id: 'project-empty-2',
    title: 'Untitled Score',
    subtitle: '',
    icon: faFileMusic,
    action: 'placeholder',
    kind: 'score',
    updatedAt: 'Empty',
  },
];

const ScorePreview = () => {
  return (
    <View style={styles.sheetPreview}>
      <View style={styles.sheetPreviewHeader} />
      <View style={styles.staffGroup}>
        <View style={styles.staffLine} />
        <View style={styles.staffLine} />
        <View style={styles.staffLine} />
      </View>
      <View style={styles.staffGroupTight}>
        <View style={styles.staffLineLight} />
        <View style={styles.staffLineLight} />
      </View>
    </View>
  );
};

const ScoreCard = ({ project, width, onPress }) => {
  return (
    <Pressable onPress={() => onPress(project)} style={[styles.projectCard, { width }]}>
      <View style={styles.projectCardTop}>
        <View style={styles.projectIconWrap}>
          <FontAwesomeIcon icon={project.icon} size={18} color={COLORS.primary} />
        </View>
        <View style={styles.metaBadge}>
          <Text style={styles.metaBadgeText}>{project.updatedAt}</Text>
        </View>
      </View>

      <ScorePreview />

      <Text style={styles.projectTitle}>{project.title}</Text>
      <Text style={styles.projectSubtitle}>{project.subtitle || 'Open score'}</Text>
    </Pressable>
  );
};

export default function UploadScreen({ navigation }) {
  const { width } = useWindowDimensions();
  const apiBaseUrl = getApiBaseUrl();

  const [latestProject, setLatestProject] = useState(null);
  const [viewMode, setViewMode] = useState('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const pollTimerRef = useRef(null);

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

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', async () => {
      if (latestProject?.jobId && latestProject?.pageManifestPath) {
        try {
          const response = await fetch(`${apiBaseUrl}${latestProject.pageManifestPath}`);
          const data = await response.json();

          if (response.ok && data.title) {
            setLatestProject((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                title: data.title,
              };
            });
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
        Alert.alert(
          'Invalid Code',
          data.detail || 'The share code you entered is invalid or expired.'
        );
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

      if (job.error || job.status === 'failed') {
        throw new Error(job.error || 'Transcription failed.');
      }

      if (transcriptionDone && job.files?.score_pages) {
        clearPollTimer();
        setLatestProject({
          id: `project-${nextJobId}`,
          title: fileName,
          subtitle: 'Ready to open',
          icon: faFileMusic,
          action: 'open',
          kind: 'score',
          updatedAt: 'Just now',
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
      Alert.alert('Transcription Error', error.message);
    }
  };

  const uploadPdf = async (fileAsset) => {
    const isMusicXML =
      fileAsset.name?.toLowerCase().endsWith('.mxl') ||
      fileAsset.name?.toLowerCase().endsWith('.musicxml');

    const formData = new FormData();

    if (Platform.OS === 'web' && fileAsset.file) {
      formData.append('file', fileAsset.file, fileAsset.name || 'score.pdf');
    } else {
      formData.append('file', {
        uri: fileAsset.uri,
        name: fileAsset.name || 'score.pdf',
        type:
          fileAsset.mimeType ||
          (isMusicXML
            ? 'application/vnd.recordare.musicxml+xml'
            : 'application/pdf'),
      });
    }

    try {
      const response = await fetch(`${apiBaseUrl}/api/transcribe`, {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Upload failed.');
      }

      pollJobStatus(data.job_id, fileAsset.name || 'Uploaded score');
    } catch (error) {
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
        type:
          Platform.OS === 'web'
            ? ['application/pdf', '.mxl', '.musicxml']
            : '*/*',
      });

      if (result.canceled) {
        return;
      }

      const fileAsset = result.assets[0];

      const validExtensions = ['.pdf', '.mxl', '.musicxml'];
      const hasValidExtension = validExtensions.some((ext) =>
        fileAsset.name?.toLowerCase().endsWith(ext)
      );

      if (!hasValidExtension) {
        Alert.alert('Invalid File', 'Please select a PDF or MusicXML (.mxl) file.');
        return;
      }

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

    return [
      DEFAULT_PROJECTS[0],
      latestProject,
      DEFAULT_PROJECTS[1],
      DEFAULT_PROJECTS[2],
      DEFAULT_PROJECTS[3],
    ];
  }, [latestProject]);

  const libraryProjectsBase = useMemo(() => {
    return projects.filter((project) => project.action !== 'upload' && project.action !== 'join');
  }, [projects]);

  const filteredProjects = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return libraryProjectsBase;

    return libraryProjectsBase.filter((project) => {
      return `${project.title} ${project.subtitle || ''} ${project.updatedAt || ''}`
        .toLowerCase()
        .includes(query);
    });
  }, [libraryProjectsBase, searchQuery]);

  const isTablet = width >= 768;
  const isWideTablet = width >= 980;
  const pagePadding = isWideTablet ? 30 : isTablet ? 24 : 18;
  const cardWidth = isTablet ? '48.6%' : '100%';

  if (!fontsLoaded) {
    return null;
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingHorizontal: pagePadding, paddingVertical: pagePadding },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.pageShell}>
          <View style={styles.topColumn}>
            <View style={styles.heroBlock}>
              <Text style={styles.brand}>Scorely</Text>
            </View>

            <View style={styles.quickActionsCard}>
              <Pressable style={styles.primaryAction} onPress={pickDocument}>
                <View style={styles.primaryActionIcon}>
                  <FontAwesomeIcon icon={faUpload} size={18} color={COLORS.card} />
                </View>
                <View style={styles.primaryActionTextWrap}>
                  <Text style={styles.primaryActionTitle}>Upload a PDF or MXL</Text>
                </View>
              </Pressable>

              <Pressable style={styles.secondaryAction} onPress={joinSharedScore}>
                <FontAwesomeIcon icon={faUserPlus} size={15} color={COLORS.primary} />
                <Text style={styles.secondaryActionText}>Join with share code</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.toolbarCard}>
            <View style={[styles.toolbarRow, !isTablet && styles.toolbarRowStack]}>
              <View style={styles.libraryTitleWrap}>
                <Text style={styles.sectionTitle}>Library</Text>
              </View>

              <View style={[styles.controlsWrap, !isTablet && styles.controlsWrapStack]}>
                <View style={styles.searchWrap}>
                  <FontAwesomeIcon icon={faMagnifyingGlass} size={14} color={COLORS.muted} />
                  <TextInput
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder="Search library"
                    placeholderTextColor={COLORS.muted}
                    style={styles.searchInput}
                  />
                </View>

                <View style={styles.viewToggle}>
                  <Pressable
                    onPress={() => setViewMode('grid')}
                    style={[styles.viewButton, viewMode === 'grid' && styles.viewButtonActive]}
                  >
                    <FontAwesomeIcon
                      icon={faGrip}
                      size={14}
                      color={viewMode === 'grid' ? COLORS.card : COLORS.primary}
                    />
                    <Text
                      style={[
                        styles.viewButtonText,
                        viewMode === 'grid' && styles.viewButtonTextActive,
                      ]}
                    >
                      Grid
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setViewMode('list')}
                    style={[styles.viewButton, viewMode === 'list' && styles.viewButtonActive]}
                  >
                    <FontAwesomeIcon
                      icon={faBars}
                      size={14}
                      color={viewMode === 'list' ? COLORS.card : COLORS.primary}
                    />
                    <Text
                      style={[
                        styles.viewButtonText,
                        viewMode === 'list' && styles.viewButtonTextActive,
                      ]}
                    >
                      List
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </View>

          <View style={styles.mainGrid}>
            <View style={styles.libraryColumn}>
              <View style={styles.subsection}>
                <Text style={styles.subsectionTitle}>Recent scores</Text>

                {viewMode === 'grid' ? (
                  <View style={styles.gridList}>
                    {filteredProjects.map((project) => (
                      <ScoreCard
                        key={project.id}
                        project={project}
                        width={cardWidth}
                        onPress={openProject}
                      />
                    ))}
                  </View>
                ) : (
                  <View style={styles.listWrap}>
                    {filteredProjects.map((project, index) => (
                      <Pressable
                        key={project.id}
                        onPress={() => openProject(project)}
                        style={[
                          styles.listRow,
                          index === filteredProjects.length - 1 && styles.listRowLast,
                        ]}
                      >
                        <View style={styles.listRowLeft}>
                          <View style={styles.projectIconWrapSmall}>
                            <FontAwesomeIcon
                              icon={project.icon}
                              size={16}
                              color={COLORS.primary}
                            />
                          </View>
                          <View style={styles.listCopyWrap}>
                            <Text style={styles.listTitle}>{project.title}</Text>
                            <Text style={styles.listSubtitle}>
                              {project.subtitle || 'Open score'}
                            </Text>
                          </View>
                        </View>

                        <View style={styles.listMeta}>
                          <Text style={styles.listMetaText}>{project.updatedAt}</Text>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            </View>
          </View>
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
    alignItems: 'center',
  },

  pageShell: {
    width: '100%',
    maxWidth: 1040,
    alignSelf: 'center',
  },

  topColumn: {
    flexDirection: 'column',
    gap: 14,
    marginBottom: 20,
    alignItems: 'center',
  },

  heroBlock: {
    width: '100%',
    maxWidth: 860,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 8,
  },

  quickActionsCard: {
    width: '100%',
    maxWidth: 940,
    backgroundColor: COLORS.card,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    padding: 20,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
    alignSelf: 'center',
  },

  primaryAction: {
    backgroundColor: COLORS.primary,
    borderRadius: 22,
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },

  primaryActionIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(255,253,248,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },

  primaryActionTextWrap: {
    flex: 1,
  },

  primaryActionTitle: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 19,
    color: COLORS.card,
  },

  secondaryAction: {
    borderWidth: 1,
    borderColor: COLORS.stroke,
    backgroundColor: COLORS.accentSoft,
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },

  secondaryActionText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 18,
    color: COLORS.primary,
  },

  brand: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 44,
    color: COLORS.primary,
    marginBottom: 0,
    textAlign: 'center',
  },

  toolbarCard: {
    width: '100%',
    maxWidth: 940,
    alignSelf: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    padding: 20,
    marginBottom: 18,
  },

  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },

  toolbarRowStack: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },

  libraryTitleWrap: {
    flex: 1,
  },

  sectionTitle: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 28,
    color: COLORS.primary,
    marginBottom: 4,
  },

  controlsWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  controlsWrapStack: {
    width: '100%',
    flexDirection: 'column',
    alignItems: 'stretch',
  },

  searchWrap: {
    minWidth: 240,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'web' ? 12 : 10,
  },

  searchInput: {
    flex: 1,
    fontFamily: 'Afacad_400Regular',
    fontSize: 17,
    color: COLORS.primary,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}),
  },

  viewToggle: {
    flexDirection: 'row',
    backgroundColor: COLORS.background,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    padding: 4,
  },

  viewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
  },

  viewButtonActive: {
    backgroundColor: COLORS.primary,
  },

  viewButtonText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 16,
    color: COLORS.primary,
  },

  viewButtonTextActive: {
    color: COLORS.card,
  },

  mainGrid: {
    width: '100%',
    maxWidth: 940,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 18,
    flexWrap: 'wrap',
  },

  libraryColumn: {
    flex: 1,
    minWidth: 320,
    maxWidth: 940,
  },

  sidebarColumn: {
    width: 300,
    maxWidth: '100%',
    gap: 14,
    marginTop: 4,
  },

  subsection: {
    marginBottom: 12,
  },

  subsectionTitle: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 24,
    color: COLORS.primary,
    marginBottom: 12,
  },

  gridList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },

  projectCard: {
    backgroundColor: COLORS.card,
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },

  projectCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },

  metaBadge: {
    backgroundColor: COLORS.accentSoft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: COLORS.stroke,
  },

  metaBadgeText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 13,
    color: COLORS.muted,
  },

  projectIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#F2E8DA',
    alignItems: 'center',
    justifyContent: 'center',
  },

  projectIconWrapSmall: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#F2E8DA',
    alignItems: 'center',
    justifyContent: 'center',
  },

  sheetPreview: {
    backgroundColor: COLORS.cardSoft,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    borderRadius: 18,
    height: 100,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 14,
    justifyContent: 'space-between',
  },

  sheetPreviewHeader: {
    width: '44%',
    height: 8,
    borderRadius: 999,
    backgroundColor: COLORS.accent,
  },

  staffGroup: {
    gap: 10,
  },

  staffGroupTight: {
    gap: 10,
  },

  staffLine: {
    width: '100%',
    height: 8,
    borderRadius: 999,
    backgroundColor: '#EDE2D3',
  },

  staffLineLight: {
    width: '88%',
    height: 8,
    borderRadius: 999,
    backgroundColor: '#F1E8DC',
  },

  projectTitle: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 21,
    color: COLORS.primary,
    marginBottom: 4,
  },

  projectSubtitle: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 15,
    lineHeight: 20,
    color: COLORS.muted,
  },

  listWrap: {
    backgroundColor: COLORS.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    overflow: 'hidden',
  },

  listRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#EFE4D6',
    gap: 12,
  },

  listRowLast: {
    borderBottomWidth: 0,
  },

  listRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },

  listCopyWrap: {
    flex: 1,
  },

  listTitle: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 19,
    color: COLORS.primary,
  },

  listSubtitle: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 15,
    color: COLORS.muted,
    marginTop: 2,
  },

  listMeta: {
    marginLeft: 12,
  },

  listMetaText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 14,
    color: COLORS.muted,
  },

  statusCard: {
    backgroundColor: COLORS.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    padding: 18,
  },

  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 12,
  },

  statusHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },

  statusCopyWrap: {
    flex: 1,
  },

  statusIconBubble: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: COLORS.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  statusTitle: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 18,
    color: COLORS.primary,
  },

  statusLabel: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 14,
    color: COLORS.muted,
    marginTop: 2,
  },

  statusText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 17,
    color: COLORS.primary,
    lineHeight: 22,
  },

  jobText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 14,
    color: COLORS.muted,
    marginTop: 10,
  },

  infoCard: {
    backgroundColor: COLORS.accentSoft,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    padding: 18,
  },

  infoCardTitle: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 18,
    color: COLORS.primary,
    marginBottom: 10,
  },

  infoChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
  },

  infoChipText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 14,
    color: COLORS.primary,
  },

  infoCardBody: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 16,
    lineHeight: 22,
    color: COLORS.muted,
  },
});
