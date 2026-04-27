import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
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
import { SvgUri } from 'react-native-svg';
import {
  faBars,
  faEllipsisVertical,
  faFileMusic,
  faGrip,
  faMagnifyingGlass,
  faMusic,
  faPen,
  faTrash,
  faUpload,
  faUserPlus,
} from '@fortawesome/free-solid-svg-icons';
import { faPenToSquare } from '@fortawesome/free-regular-svg-icons';
import * as DocumentPicker from 'expo-document-picker';
import { getApiBaseUrl } from '../services/apiBaseUrl';
import { initializeUserIdentity, setUsername } from '../services/userIdentity';

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
];

const SCORE_TITLE_OVERRIDES = {
  'String Quartet in A minor, Op.2548 (Beatty, Stephen W.)': 'String Quartet in A minor',
  '3065 Quartet for Clarinet, Violin, Viola and Cello':
    'Quartet for Clarinet, Violin, Viola and Cello',
  'Quartet for Clarinet, Violin, Viola and Cello in C major, Op.3065 (Beatty, Stephen W.)':
    'Quartet for Clarinet, Violin, Viola and Cello',
};

const getDisplayTitle = (title) => SCORE_TITLE_OVERRIDES[title] || title;
const DEFAULT_PREVIEW_ASPECT_RATIO = 0.707;

const buildPreviewUri = (project, apiBaseUrl) => {
  if (!project?.previewImagePath) {
    return null;
  }

  if (/^https?:\/\//i.test(project.previewImagePath)) {
    return project.previewImagePath;
  }

  return `${apiBaseUrl}${project.previewImagePath}`;
};

const hydrateProjectPreview = async (project, apiBaseUrl) => {
  if (!project?.pageManifestPath) {
    return project;
  }

  try {
    const response = await fetch(`${apiBaseUrl}${project.pageManifestPath}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || 'Failed to load score preview.');
    }

    return {
      ...project,
      title: getDisplayTitle(data.title || project.title),
      previewImagePath: data.pages?.[0]?.image_path || project.previewImagePath || null,
      previewAspectRatio:
        data.pages?.[0]?.width && data.pages?.[0]?.height
          ? data.pages[0].width / data.pages[0].height
          : project.previewAspectRatio || DEFAULT_PREVIEW_ASPECT_RATIO,
    };
  } catch (error) {
    console.error('Failed to load score preview:', error);
    return project;
  }
};

const ScorePreview = ({ project, apiBaseUrl }) => {
  const previewUri = buildPreviewUri(project, apiBaseUrl);
  const isSvgPreview = previewUri?.toLowerCase().includes('.svg');
  const shouldUseSvgRenderer = isSvgPreview && Platform.OS !== 'web';
  const previewAspectRatio = project.previewAspectRatio || DEFAULT_PREVIEW_ASPECT_RATIO;

  return (
    <View style={styles.sheetPreview}>
      {previewUri ? (
        <View style={[styles.sheetPreviewAsset, { aspectRatio: previewAspectRatio }]}>
          {shouldUseSvgRenderer ? (
            <SvgUri uri={previewUri} width="100%" height="100%" style={styles.sheetPreviewSvg} />
          ) : (
            <Image source={{ uri: previewUri }} style={styles.sheetPreviewImage} resizeMode="cover" />
          )}
        </View>
      ) : (
        <View style={styles.sheetPreviewEmpty}>
          <FontAwesomeIcon icon={faFileMusic} size={18} color={COLORS.muted} />
          <Text style={styles.sheetPreviewEmptyText}>Preview loading</Text>
        </View>
      )}
    </View>
  );
};

const ScoreCard = ({ project, width, onPress, onMorePress, apiBaseUrl }) => {
  return (
    <Pressable onPress={() => onPress(project)} style={[styles.projectCard, { width }]}>
      <View style={styles.projectCardTop}>
        <Pressable
          style={styles.overflowIconWrap}
          onPress={(e) => { e.stopPropagation(); onMorePress && onMorePress(project); }}
          hitSlop={8}
        >
          <FontAwesomeIcon icon={faEllipsisVertical} size={14} color={COLORS.muted} />
        </Pressable>
        <View style={styles.metaBadge}>
          <Text style={styles.metaBadgeText}>{project.updatedAt}</Text>
        </View>
      </View>

      <ScorePreview project={project} apiBaseUrl={apiBaseUrl} />

      <Text style={styles.projectTitle}>{project.title}</Text>
      {project.subtitle ? <Text style={styles.projectSubtitle}>{project.subtitle}</Text> : null}
    </Pressable>
  );
};

const formatProjectUpdatedAt = (modifiedAt) => {
  if (!modifiedAt) {
    return 'Recent';
  }

  const parsedDate = new Date(modifiedAt);
  if (Number.isNaN(parsedDate.getTime())) {
    return 'Recent';
  }

  const today = new Date();
  if (parsedDate.toDateString() === today.toDateString()) {
    return 'Today';
  }

  return parsedDate.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
};

export default function UploadScreen({ navigation }) {
  const { width } = useWindowDimensions();
  const apiBaseUrl = getApiBaseUrl();

  const [latestProject, setLatestProject] = useState(null);
  const [seededProjects, setSeededProjects] = useState([]);
  const [viewMode, setViewMode] = useState('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [username, setUsernameState] = useState('');
  const [userId, setUserId] = useState('');
  const [isUsernameModalVisible, setIsUsernameModalVisible] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [isUpdatingUsername, setIsUpdatingUsername] = useState(false);
  const [isJoinModalVisible, setIsJoinModalVisible] = useState(false);
  const [shareCodeInput, setShareCodeInput] = useState('');
  const [isJoiningSharedScore, setIsJoiningSharedScore] = useState(false);
  const [actionMenuProject, setActionMenuProject] = useState(null);
  const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);
  const [isRenameModalVisible, setIsRenameModalVisible] = useState(false);
  const [renameInput, setRenameInput] = useState('');
  const [isDeletingScore, setIsDeletingScore] = useState(false);
  const [isRenamingScore, setIsRenamingScore] = useState(false);
  const pollTimerRef = useRef(null);

  const [fontsLoaded] = useFonts({
    Afacad_400Regular,
  });

  useEffect(() => {
    initializeUserIdentity().then(({ userId, username }) => {
      setUserId(userId);
      setUsernameState(username);
    });
  }, []);

  useEffect(() => {
    if (!userId) return;
    let isActive = true;

    const loadSeededProjects = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/library/recent-scores?user_id=${encodeURIComponent(userId)}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.detail || 'Failed to load recent scores.');
        }

        if (!isActive) {
          return;
        }

        const baseProjects = (data.scores || []).map((score) => ({
          id: `project-${score.job_id}`,
          title: getDisplayTitle(score.title),
          subtitle: '',
          icon: faFileMusic,
          action: 'open',
          kind: 'score',
          updatedAt: formatProjectUpdatedAt(score.modified_at),
          jobId: score.job_id,
          musicxmlPath: score.musicxml_path,
          pageManifestPath: score.page_manifest_path,
        }));

        const projectsWithPreviews = await Promise.all(
          baseProjects.map((project) => hydrateProjectPreview(project, apiBaseUrl))
        );

        if (!isActive) {
          return;
        }

        setSeededProjects(projectsWithPreviews);
      } catch (error) {
        if (isActive) {
          console.error('Failed to load recent library scores:', error);
          setSeededProjects([]);
        }
      }
    };

    loadSeededProjects();

    return () => {
      isActive = false;
    };
  }, [apiBaseUrl, userId]);

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

          if (response.ok) {
            setLatestProject((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                title: getDisplayTitle(data.title || prev.title),
                previewImagePath: data.pages?.[0]?.image_path || prev.previewImagePath || null,
                previewAspectRatio:
                  data.pages?.[0]?.width && data.pages?.[0]?.height
                    ? data.pages[0].width / data.pages[0].height
                    : prev.previewAspectRatio || DEFAULT_PREVIEW_ASPECT_RATIO,
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

  const openUsernameModal = () => {
    setUsernameInput(username);
    setIsUsernameModalVisible(true);
  };

  const closeUsernameModal = () => {
    if (isUpdatingUsername) {
      return;
    }

    setIsUsernameModalVisible(false);
    setUsernameInput('');
  };

  const confirmUsernameUpdate = async () => {
    const nextUsername = usernameInput.trim();
    if (!nextUsername) {
      return;
    }

    setIsUpdatingUsername(true);
    try {
      const success = await setUsername(nextUsername);
      if (!success) {
        throw new Error('Unable to update your username.');
      }

      setUsernameState(nextUsername);
      setIsUsernameModalVisible(false);
      setUsernameInput('');
    } catch (error) {
      Alert.alert('Username Error', error.message);
    } finally {
      setIsUpdatingUsername(false);
    }
  };

  const openJoinSharedScoreModal = () => {
    setShareCodeInput('');
    setIsJoinModalVisible(true);
  };

  const closeJoinSharedScoreModal = () => {
    if (isJoiningSharedScore) {
      return;
    }

    setIsJoinModalVisible(false);
    setShareCodeInput('');
  };

  const joinSharedScore = async (rawCode) => {
    const code = rawCode.trim().toUpperCase();
    if (code.length !== 6) {
      return;
    }

    setIsJoiningSharedScore(true);

    try {
      const response = await fetch(`${apiBaseUrl}/api/resolve-code/${code}`);
      const data = await response.json();

      if (response.ok) {
        setIsJoinModalVisible(false);
        setShareCodeInput('');
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
    } finally {
      setIsJoiningSharedScore(false);
    }
  };

  const openMoreMenu = (project) => {
    setActionMenuProject(project);
  };

  const closeMoreMenu = () => {
    setActionMenuProject(null);
  };

  const openDeleteModal = () => {
    setIsDeleteModalVisible(true);
  };

  const closeDeleteModal = () => {
    if (isDeletingScore) return;
    setIsDeleteModalVisible(false);
    setActionMenuProject(null);
  };

  const openRenameModal = () => {
    setRenameInput(actionMenuProject?.title || '');
    setIsRenameModalVisible(true);
  };

  const closeRenameModal = () => {
    if (isRenamingScore) return;
    setIsRenameModalVisible(false);
    setActionMenuProject(null);
  };

  const confirmDelete = async () => {
    if (!actionMenuProject?.jobId) return;
    setIsDeletingScore(true);
    try {
      const deleteUrl = userId
        ? `${apiBaseUrl}/api/score/${actionMenuProject.jobId}?user_id=${encodeURIComponent(userId)}`
        : `${apiBaseUrl}/api/score/${actionMenuProject.jobId}`;
      const response = await fetch(deleteUrl, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to delete score.');
      }
      setSeededProjects((prev) => prev.filter((p) => p.jobId !== actionMenuProject.jobId));
      if (latestProject?.jobId === actionMenuProject.jobId) {
        setLatestProject(null);
      }
      setIsDeleteModalVisible(false);
      setActionMenuProject(null);
    } catch (error) {
      Alert.alert('Delete Error', error.message);
    } finally {
      setIsDeletingScore(false);
    }
  };

  const confirmRename = async () => {
    const newTitle = renameInput.trim();
    if (!newTitle || !actionMenuProject?.jobId) return;
    setIsRenamingScore(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/score/${actionMenuProject.jobId}/title`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to rename score.');
      }
      const updater = (p) => p.jobId === actionMenuProject.jobId ? { ...p, title: newTitle } : p;
      setSeededProjects((prev) => prev.map(updater));
      if (latestProject?.jobId === actionMenuProject.jobId) {
        setLatestProject((prev) => prev ? { ...prev, title: newTitle } : prev);
      }
      setIsRenameModalVisible(false);
      setActionMenuProject(null);
    } catch (error) {
      Alert.alert('Rename Error', error.message);
    } finally {
      setIsRenamingScore(false);
    }
  };

  const openProject = (project) => {
    if (project.action === 'upload') {
      pickDocument();
      return;
    }

    if (project.action === 'join') {
      openJoinSharedScoreModal();
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
      return [DEFAULT_PROJECTS[0], DEFAULT_PROJECTS[1], ...seededProjects];
    }

    return [
      DEFAULT_PROJECTS[0],
      latestProject,
      DEFAULT_PROJECTS[1],
      ...seededProjects,
    ];
  }, [latestProject, seededProjects]);

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
              {username && (
                <View style={styles.usernameContainer}>
                  <Text style={styles.usernameText}>{username}</Text>
                  <Pressable onPress={openUsernameModal} style={styles.usernameEditButton}>
                    <FontAwesomeIcon icon={faPenToSquare} size={14} color={COLORS.muted} />
                  </Pressable>
                </View>
              )}
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

              <Pressable style={styles.secondaryAction} onPress={openJoinSharedScoreModal}>
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
                        onMorePress={project.kind === 'score' && project.action === 'open' ? openMoreMenu : undefined}
                        apiBaseUrl={apiBaseUrl}
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
                          <View style={styles.listCopyWrap}>
                            <Text style={styles.listTitle}>{project.title}</Text>
                            {project.subtitle ? (
                              <Text style={styles.listSubtitle}>{project.subtitle}</Text>
                            ) : null}
                          </View>
                        </View>

                        <View style={styles.listMeta}>
                          <Text style={styles.listMetaText}>{project.updatedAt}</Text>
                          {project.kind === 'score' && project.action === 'open' ? (
                            <Pressable
                              style={styles.listOverflowIconWrap}
                              onPress={(e) => { e.stopPropagation(); openMoreMenu(project); }}
                              hitSlop={8}
                            >
                              <FontAwesomeIcon icon={faEllipsisVertical} size={14} color={COLORS.muted} />
                            </Pressable>
                          ) : (
                            <View style={styles.listOverflowIconWrap}>
                              <FontAwesomeIcon icon={faEllipsisVertical} size={14} color={COLORS.muted} />
                            </View>
                          )}
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

      {/* Action menu modal (rename / delete) */}
      <Modal
        animationType="fade"
        transparent
        visible={!!actionMenuProject && !isDeleteModalVisible && !isRenameModalVisible}
        onRequestClose={closeMoreMenu}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={closeMoreMenu} />
          <View style={[styles.modalCard, styles.actionMenuCard]}>
            <Text style={styles.actionMenuTitle} numberOfLines={2}>
              {actionMenuProject?.title}
            </Text>
            <Pressable
              style={styles.actionMenuItem}
              onPress={() => { openRenameModal(); }}
            >
              <View style={styles.actionMenuIconWrap}>
                <FontAwesomeIcon icon={faPen} size={15} color={COLORS.primary} />
              </View>
              <Text style={styles.actionMenuItemText}>Rename</Text>
            </Pressable>
            <Pressable
              style={[styles.actionMenuItem, styles.actionMenuItemDestructive]}
              onPress={() => { openDeleteModal(); }}
            >
              <View style={[styles.actionMenuIconWrap, styles.actionMenuIconDestructive]}>
                <FontAwesomeIcon icon={faTrash} size={15} color='#C0392B' />
              </View>
              <Text style={styles.actionMenuItemTextDestructive}>Delete</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Delete confirmation modal */}
      <Modal
        animationType="fade"
        transparent
        visible={isDeleteModalVisible}
        onRequestClose={closeDeleteModal}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={closeDeleteModal} />
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={[styles.modalIconWrap, styles.modalIconDestructive]}>
                <FontAwesomeIcon icon={faTrash} size={18} color='#C0392B' />
              </View>
              <Text style={styles.modalTitle}>Delete score</Text>
              <Text style={styles.modalSubtitle}>
                Are you sure you want to delete "{actionMenuProject?.title}"? This cannot be undone.
              </Text>
            </View>
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalSecondaryButton, isDeletingScore && styles.buttonDisabled]}
                onPress={closeDeleteModal}
                disabled={isDeletingScore}
              >
                <Text style={styles.modalSecondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalDestructiveButton, isDeletingScore && styles.buttonDisabled]}
                onPress={confirmDelete}
                disabled={isDeletingScore}
              >
                {isDeletingScore ? (
                  <ActivityIndicator size="small" color={COLORS.card} />
                ) : (
                  <Text style={styles.modalPrimaryButtonText}>Delete</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Rename modal */}
      <Modal
        animationType="fade"
        transparent
        visible={isRenameModalVisible}
        onRequestClose={closeRenameModal}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={closeRenameModal} />
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalIconWrap}>
                <FontAwesomeIcon icon={faPen} size={18} color={COLORS.primary} />
              </View>
              <Text style={styles.modalTitle}>Rename score</Text>
              <Text style={styles.modalSubtitle}>
                Enter a new name for this score.
              </Text>
            </View>
            <View style={styles.modalInputWrap}>
              <Text style={styles.modalInputLabel}>Title</Text>
              <TextInput
                value={renameInput}
                onChangeText={setRenameInput}
                placeholder="Score title"
                placeholderTextColor={COLORS.muted}
                autoCorrect={false}
                autoFocus
                editable={!isRenamingScore}
                returnKeyType="done"
                onSubmitEditing={() => { if (renameInput.trim()) confirmRename(); }}
                style={styles.modalInputNormal}
              />
            </View>
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalSecondaryButton, isRenamingScore && styles.buttonDisabled]}
                onPress={closeRenameModal}
                disabled={isRenamingScore}
              >
                <Text style={styles.modalSecondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modalPrimaryButton,
                  (!renameInput.trim() || isRenamingScore) && styles.buttonDisabled,
                ]}
                onPress={confirmRename}
                disabled={!renameInput.trim() || isRenamingScore}
              >
                {isRenamingScore ? (
                  <ActivityIndicator size="small" color={COLORS.card} />
                ) : (
                  <Text style={styles.modalPrimaryButtonText}>Rename</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={isUsernameModalVisible}
        onRequestClose={closeUsernameModal}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={closeUsernameModal} />
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalIconWrap}>
                <FontAwesomeIcon icon={faPenToSquare} size={18} color={COLORS.primary} />
              </View>
              <Text style={styles.modalTitle}>Edit username</Text>
              <Text style={styles.modalSubtitle}>
                Enter the name you want other collaborators to see.
              </Text>
            </View>
            <View style={styles.modalInputWrap}>
              <Text style={styles.modalInputLabel}>Username</Text>
              <TextInput
                value={usernameInput}
                onChangeText={setUsernameInput}
                placeholder="Your username"
                placeholderTextColor={COLORS.muted}
                autoCorrect={false}
                autoFocus
                editable={!isUpdatingUsername}
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (usernameInput.trim()) {
                    confirmUsernameUpdate();
                  }
                }}
                style={styles.modalInputNormal}
              />
            </View>
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalSecondaryButton, isUpdatingUsername && styles.buttonDisabled]}
                onPress={closeUsernameModal}
                disabled={isUpdatingUsername}
              >
                <Text style={styles.modalSecondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modalPrimaryButton,
                  (!usernameInput.trim() || isUpdatingUsername) && styles.buttonDisabled,
                ]}
                onPress={confirmUsernameUpdate}
                disabled={!usernameInput.trim() || isUpdatingUsername}
              >
                {isUpdatingUsername ? (
                  <ActivityIndicator size="small" color={COLORS.card} />
                ) : (
                  <Text style={styles.modalPrimaryButtonText}>Save</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={isJoinModalVisible}
        onRequestClose={closeJoinSharedScoreModal}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={closeJoinSharedScoreModal} />
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalIconWrap}>
                <FontAwesomeIcon icon={faUserPlus} size={18} color={COLORS.primary} />
              </View>
              <Text style={styles.modalTitle}>Join shared score</Text>
              <Text style={styles.modalSubtitle}>
                Enter the 6-character share code to open a collaborative score.
              </Text>
            </View>

            <View style={styles.modalInputWrap}>
              <Text style={styles.modalInputLabel}>Share code</Text>
              <TextInput
                value={shareCodeInput}
                onChangeText={(value) => {
                  const sanitized = value.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 6);
                  setShareCodeInput(sanitized);
                }}
                placeholder="ABC123"
                placeholderTextColor={COLORS.muted}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={6}
                autoFocus
                editable={!isJoiningSharedScore}
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (shareCodeInput.trim().length === 6) {
                    joinSharedScore(shareCodeInput);
                  }
                }}
                style={styles.modalInput}
              />
            </View>

            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalSecondaryButton, isJoiningSharedScore && styles.buttonDisabled]}
                onPress={closeJoinSharedScoreModal}
                disabled={isJoiningSharedScore}
              >
                <Text style={styles.modalSecondaryButtonText}>Cancel</Text>
              </Pressable>

              <Pressable
                style={[
                  styles.modalPrimaryButton,
                  (isJoiningSharedScore || shareCodeInput.trim().length !== 6) &&
                    styles.buttonDisabled,
                ]}
                onPress={() => joinSharedScore(shareCodeInput)}
                disabled={isJoiningSharedScore || shareCodeInput.trim().length !== 6}
              >
                {isJoiningSharedScore ? (
                  <ActivityIndicator size="small" color={COLORS.card} />
                ) : (
                  <Text style={styles.modalPrimaryButtonText}>Join score</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
    position: 'relative',
  },

  usernameContainer: {
    position: 'absolute',
    top: 8,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.card,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.stroke,
  },

  usernameText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 16,
    color: COLORS.primary,
  },

  usernameEditButton: {
    padding: 4,
  },

  quickActionsCard: {
    width: '100%',
    maxWidth: 940,
    backgroundColor: COLORS.card,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    padding: 20,
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
    backgroundColor: COLORS.background,
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

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(49, 31, 24, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },

  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },

  modalCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: COLORS.card,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    padding: 24,
    shadowColor: '#2B1912',
    shadowOpacity: 0.14,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },

  modalHeader: {
    marginBottom: 20,
  },

  modalIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: COLORS.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },

  modalTitle: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 28,
    color: COLORS.primary,
    marginBottom: 6,
  },

  modalSubtitle: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 17,
    lineHeight: 22,
    color: COLORS.muted,
  },

  modalInputWrap: {
    marginBottom: 22,
  },

  modalInputLabel: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 16,
    color: COLORS.primary,
    marginBottom: 8,
  },

  modalInput: {
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'web' ? 13 : 12,
    fontFamily: 'Afacad_400Regular',
    fontSize: 24,
    letterSpacing: 2,
    color: COLORS.primary,
    textTransform: 'uppercase',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}),
  },

  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },

  modalSecondaryButton: {
    borderWidth: 1,
    borderColor: COLORS.stroke,
    backgroundColor: COLORS.background,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 13,
    minWidth: 108,
    alignItems: 'center',
    justifyContent: 'center',
  },

  modalSecondaryButtonText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 17,
    color: COLORS.primary,
  },

  modalPrimaryButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 13,
    minWidth: 128,
    alignItems: 'center',
    justifyContent: 'center',
  },

  modalPrimaryButtonText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 17,
    color: COLORS.card,
  },

  buttonDisabled: {
    opacity: 0.55,
  },

  actionMenuCard: {
    padding: 8,
    maxWidth: 280,
  },

  actionMenuTitle: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 15,
    color: COLORS.muted,
    paddingHorizontal: 14,
    paddingVertical: 10,
    paddingBottom: 6,
  },

  actionMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 14,
  },

  actionMenuItemDestructive: {
    marginTop: 2,
  },

  actionMenuIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: COLORS.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  actionMenuIconDestructive: {
    backgroundColor: '#FDF0EF',
  },

  actionMenuItemText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 17,
    color: COLORS.primary,
  },

  actionMenuItemTextDestructive: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 17,
    color: '#C0392B',
  },

  modalIconDestructive: {
    backgroundColor: '#FDF0EF',
  },

  modalDestructiveButton: {
    backgroundColor: '#C0392B',
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 13,
    minWidth: 128,
    alignItems: 'center',
    justifyContent: 'center',
  },

  modalInputNormal: {
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'web' ? 13 : 12,
    fontFamily: 'Afacad_400Regular',
    fontSize: 18,
    color: COLORS.primary,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}),
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
  },

  projectCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },

  overflowIconWrap: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },

  metaBadge: {
    backgroundColor: COLORS.background,
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

  sheetPreview: {
    backgroundColor: COLORS.cardSoft,
    borderWidth: 1,
    borderColor: COLORS.stroke,
    borderRadius: 18,
    height: 136,
    marginBottom: 14,
    overflow: 'hidden',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
  },

  sheetPreviewAsset: {
    width: '100%',
  },

  sheetPreviewSvg: {
    flex: 1,
    backgroundColor: COLORS.cardSoft,
  },

  sheetPreviewImage: {
    width: '100%',
    height: '100%',
    backgroundColor: COLORS.cardSoft,
  },

  sheetPreviewEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F8F3EB',
  },

  sheetPreviewEmptyText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 14,
    color: COLORS.muted,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },

  listMetaText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 14,
    color: COLORS.muted,
  },

  listOverflowIconWrap: {
    width: 20,
    alignItems: 'center',
    justifyContent: 'center',
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
