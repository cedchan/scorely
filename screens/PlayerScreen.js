import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import {
  faBackward,
  faForward,
  faMusic,
  faPause,
  faPlay,
  faShare,
} from '@fortawesome/free-solid-svg-icons';
import AnnotationLayer from '../components/AnnotationLayer';
import AnnotationToolbar from '../components/AnnotationToolbar';
import annotationSyncService from '../services/annotationSync';

const COLORS = {
  beige: '#FAF7F0',
  lightBrown: '#A9988F',
  darkBrown: '#58392F',
};

const getFallbackApiBaseUrl = () => {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.location?.hostname) {
      const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
      return `${protocol}//${window.location.hostname}:8000`;
    }
  }

  return 'http://localhost:8000';
};

export default function PlayerScreen({ route }) {
  const { width, height } = useWindowDimensions();
  const scrollViewRef = useRef(null);
  const webAudioRef = useRef(null);
  const audioPollTimerRef = useRef(null);
  const [pages, setPages] = useState([]);
  const [title, setTitle] = useState(route.params?.fileName || 'Digital Score');
  const [currentPage, setCurrentPage] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [playbackUrl, setPlaybackUrl] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioError, setAudioError] = useState(null);
  const [alignmentMappings, setAlignmentMappings] = useState([]);
  const [activeMeasure, setActiveMeasure] = useState(null);

  // Annotation state
  const [annotations, setAnnotations] = useState([]);
  const [annotationsEnabled, setAnnotationsEnabled] = useState(false);
  const [currentTool, setCurrentTool] = useState('pen');
  const [currentColor, setCurrentColor] = useState('#D94848');
  const [currentStrokeWidth, setCurrentStrokeWidth] = useState(4);
  const [userId] = useState(
    () => `user-${Math.random().toString(36).slice(2, 11)}`
  );
  const [shareCode, setShareCode] = useState(null);

  const jobId = route.params?.jobId;
  const apiBaseUrl = route.params?.apiBaseUrl || getFallbackApiBaseUrl();
  const pageManifestPath = route.params?.pageManifestPath || (jobId ? `/api/score-pages/${jobId}` : null);
  const cacheToken = jobId || route.params?.fileName || 'score';
  const isTabletLayout = width >= 900;
  const pageHorizontalPadding = isTabletLayout ? 56 : 20;
  const pageVerticalPadding = isTabletLayout ? 24 : 16;
  const controlsHeight = isTabletLayout ? 108 : 94;
  const headerHeight = isTabletLayout ? 120 : 92;
  const availablePageHeight = Math.max(
    320,
    height - headerHeight - controlsHeight - pageVerticalPadding * 2
  );
  const measurePageRanges = (() => {
    if (!pages.length || !alignmentMappings.length) {
      return [];
    }

    const measuresPerPage = Math.ceil(alignmentMappings.length / pages.length);
    return pages.map((page, index) => {
      const startIndex = index * measuresPerPage;
      const endIndex = Math.min(alignmentMappings.length - 1, startIndex + measuresPerPage - 1);
      return {
        pageNumber: page.page_number,
        startIndex,
        endIndex,
        startMeasure: alignmentMappings[startIndex]?.measure ?? null,
        endMeasure: alignmentMappings[endIndex]?.measure ?? null,
      };
    });
  })();

  let [fontsLoaded] = useFonts({
    Afacad_400Regular,
  });

  useEffect(() => {
    const loadRenderedPages = async () => {
      setIsLoading(true);
      setError(null);
      setPages([]);
      setCurrentPage(0);

      if (!pageManifestPath) {
        setError('No rendered score pages are available for this job yet.');
        setIsLoading(false);
        return;
      }

      try {
        const response = await fetch(`${apiBaseUrl}${pageManifestPath}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.detail || 'Failed to load rendered score pages.');
        }

        setTitle(data.title || route.params?.fileName || 'Digital Score');
        setPages(
          data.pages.map((page) => ({
            ...page,
            uri: `${apiBaseUrl}${page.image_path}?job=${encodeURIComponent(cacheToken)}&page=${page.page_number}`,
          }))
        );
      } catch (loadError) {
        setError(loadError.message);
      } finally {
        setIsLoading(false);
      }
    };

    loadRenderedPages();
  }, [apiBaseUrl, cacheToken, pageManifestPath, route.params?.fileName]);

  useEffect(() => {
    const loadAudio = async () => {
      if (!jobId) {
        setAudioUrl(null);
        return;
      }

      try {
        const response = await fetch(`${apiBaseUrl}/api/status/${jobId}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.detail || 'Failed to load audio for this score.');
        }

        if (data.progress?.audio_conversion === 'completed' && data.files?.full_audio) {
          setAudioUrl(`${apiBaseUrl}${data.files.full_audio}?job=${encodeURIComponent(cacheToken)}`);
          setAudioError(null);
          return;
        }

        setAudioUrl(null);
        audioPollTimerRef.current = setTimeout(loadAudio, 2000);
      } catch (loadError) {
        setAudioUrl(null);
        audioPollTimerRef.current = setTimeout(loadAudio, 2000);
      }
    };

    loadAudio();

    return () => {
      if (audioPollTimerRef.current) {
        clearTimeout(audioPollTimerRef.current);
        audioPollTimerRef.current = null;
      }
    };
  }, [apiBaseUrl, cacheToken, jobId]);

  useEffect(() => {
    const loadAlignment = async () => {
      if (!jobId) {
        setAlignmentMappings([]);
        return;
      }

      try {
        const response = await fetch(`${apiBaseUrl}/api/alignment/${jobId}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.detail || 'Failed to load measure alignment.');
        }

        setAlignmentMappings(data.mappings || []);
      } catch (loadError) {
        setAlignmentMappings([]);
      }
    };

    loadAlignment();
  }, [apiBaseUrl, jobId]);

  useEffect(() => {
    setIsPlaying(false);
    setActiveMeasure(null);
  }, [playbackUrl]);

  // Annotation WebSocket connection
  useEffect(() => {
    if (!jobId) return;

    // Connect to annotation sync
    annotationSyncService.connect(apiBaseUrl, jobId, userId);

    // Set up event listeners
    const handleSyncResponse = ({ annotations: syncedAnnotations }) => {
      setAnnotations(syncedAnnotations);
    };

    const handleAnnotationAdded = ({ annotation }) => {
      setAnnotations((prev) => {
        // Avoid duplicates
        if (prev.some((a) => a.id === annotation.id)) {
          return prev;
        }
        return [...prev, annotation];
      });
    };

    const handleAnnotationUpdated = ({ annotation }) => {
      setAnnotations((prev) =>
        prev.map((a) => (a.id === annotation.id ? annotation : a))
      );
    };

    const handleAnnotationDeleted = ({ annotationId }) => {
      setAnnotations((prev) => prev.filter((a) => a.id !== annotationId));
    };

    const handleError = ({ error }) => {
      console.error('Annotation sync error:', error);
    };

    annotationSyncService.on('sync_response', handleSyncResponse);
    annotationSyncService.on('annotation_added', handleAnnotationAdded);
    annotationSyncService.on('annotation_updated', handleAnnotationUpdated);
    annotationSyncService.on('annotation_deleted', handleAnnotationDeleted);
    annotationSyncService.on('error', handleError);

    // Cleanup
    return () => {
      annotationSyncService.off('sync_response', handleSyncResponse);
      annotationSyncService.off('annotation_added', handleAnnotationAdded);
      annotationSyncService.off('annotation_updated', handleAnnotationUpdated);
      annotationSyncService.off('annotation_deleted', handleAnnotationDeleted);
      annotationSyncService.off('error', handleError);
      annotationSyncService.disconnect();
    };
  }, [apiBaseUrl, jobId, userId]);

  useEffect(() => {
    let objectUrl = null;

    const preparePlaybackUrl = async () => {
      if (!audioUrl) {
        setPlaybackUrl(null);
        return;
      }

      if (Platform.OS !== 'web') {
        setPlaybackUrl(audioUrl);
        return;
      }

      try {
        const response = await fetch(audioUrl);
        if (!response.ok) {
          throw new Error('Unable to show audio file.');
        }

        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        setPlaybackUrl(objectUrl);
        setAudioError(null);
      } catch (loadError) {
        setPlaybackUrl(null);
        setAudioError(loadError.message || 'Unable to show audio file.');
      }
    };

    preparePlaybackUrl();

    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [audioUrl]);

  const goToPage = (pageIndex) => {
    if (!scrollViewRef.current || pageIndex < 0 || pageIndex >= pages.length) {
      return;
    }

    scrollViewRef.current.scrollTo({
      animated: true,
      x: pageIndex * width,
      y: 0,
    });
    setCurrentPage(pageIndex);
  };

  const onMomentumScrollEnd = (event) => {
    const nextPage = Math.round(event.nativeEvent.contentOffset.x / width);
    setCurrentPage(nextPage);
  };

  const updateMeasureFromTime = (timeSeconds) => {
    if (!alignmentMappings.length) {
      return;
    }

    let nextIndex = 0;
    for (let index = 0; index < alignmentMappings.length; index += 1) {
      if (alignmentMappings[index].time_seconds <= timeSeconds) {
        nextIndex = index;
      } else {
        break;
      }
    }

    const nextMeasure = alignmentMappings[nextIndex]?.measure ?? null;
    setActiveMeasure(nextMeasure);

    const nextPageIndex = measurePageRanges.findIndex(
      (range) => nextMeasure !== null && nextMeasure >= range.startMeasure && nextMeasure <= range.endMeasure
    );

    if (nextPageIndex !== -1 && nextPageIndex !== currentPage) {
      goToPage(nextPageIndex);
    }
  };

  const togglePlayback = async () => {
    if (!playbackUrl) {
      setAudioError('Audio is not ready for this score yet.');
      return;
    }

    if (Platform.OS !== 'web') {
      setAudioError('Audio playback is currently available in the web build.');
      return;
    }

    try {
      if (!webAudioRef.current) {
        setAudioError('Audio player is not ready yet.');
        return;
      }

      setAudioError(null);

      if (webAudioRef.current.paused) {
        await webAudioRef.current.play();
      } else {
        webAudioRef.current.pause();
      }
    } catch (playbackError) {
      setAudioError(
        playbackError?.message || 'Unable to start playback. Try pressing play again.'
      );
      setIsPlaying(false);
    }
  };

  // Annotation handlers
  const handleAnnotationCreated = (annotation) => {
    // Send to server via WebSocket
    annotationSyncService.addAnnotation(annotation);

    // Optimistically add to local state
    setAnnotations((prev) => [...prev, annotation]);
  };

  const handleAnnotationUpdated = (annotation) => {
    annotationSyncService.updateAnnotation(annotation);
    setAnnotations((prev) =>
      prev.map((a) => (a.id === annotation.id ? annotation : a))
    );
  };

  const handleClearAllAnnotations = () => {
    // Delete all annotations for current page
    const pageAnnotations = annotations.filter(
      (ann) => ann.page_number === currentPage + 1
    );

    pageAnnotations.forEach((ann) => {
      annotationSyncService.deleteAnnotation(ann.id);
    });

    setAnnotations((prev) =>
      prev.filter((ann) => ann.page_number !== currentPage + 1)
    );
  };

  const handleShare = async () => {
    if (!jobId) {
      alert('Cannot share: No job ID available');
      return;
    }

    try {
      const response = await fetch(`${apiBaseUrl}/api/share/${jobId}`, {
        method: 'POST',
      });
      const data = await response.json();

      if (response.ok) {
        setShareCode(data.share_code);
        if (Platform.OS === 'web') {
          alert(`Share this code with friends:\n\n${data.share_code}\n\nThey can enter it on the home page to view this score together!`);
        }
      } else {
        alert(`Failed to generate share code: ${data.detail || 'Unknown error'}`);
      }
    } catch (error) {
      alert(`Error generating share code: ${error.message}`);
    }
  };

  if (!fontsLoaded) {
    return null;
  }

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color={COLORS.darkBrown} />
          <Text style={styles.loadingText}>Rendering readable sheet music pages...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingState}>
          <FontAwesomeIcon icon={faMusic} size={48} color={COLORS.lightBrown} />
          <Text style={styles.loadingText}>Unable to load the digital score.</Text>
          <Text style={styles.errorText}>{error}</Text>
          {jobId ? <Text style={styles.errorText}>Job ID: {jobId}</Text> : null}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerCard}>
        <View style={styles.headerTitleRow}>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.scoreTitle}>{title}</Text>
            <Text style={styles.scoreSubtitle}>
              Read the score in portrait and swipe between paginated pages.
            </Text>
          </View>
          <TouchableOpacity
            style={styles.shareButton}
            onPress={handleShare}
          >
            <FontAwesomeIcon icon={faShare} size={18} color={COLORS.darkBrown} />
            <Text style={styles.shareButtonText}>Share</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.audioRow}>
          {Platform.OS === 'web' && playbackUrl ? (
            <audio
              ref={webAudioRef}
              key={playbackUrl}
              preload="metadata"
              src={playbackUrl}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={() => setIsPlaying(false)}
              onTimeUpdate={(event) => updateMeasureFromTime(event.currentTarget.currentTime)}
              onError={() => {
                setAudioError('Unable to load the generated audio file.');
                setIsPlaying(false);
              }}
              style={styles.webAudioElement}
            />
          ) : null}
          <TouchableOpacity
            style={[styles.audioButton, !audioUrl && styles.audioButtonDisabled]}
            onPress={togglePlayback}
            disabled={!audioUrl}
          >
            <FontAwesomeIcon
              icon={isPlaying ? faPause : faPlay}
              size={18}
              color={COLORS.beige}
            />
            <Text style={styles.audioButtonText}>{isPlaying ? 'Pause Audio' : 'Play Audio'}</Text>
          </TouchableOpacity>
          <Text style={styles.audioHint}>
            {audioUrl ? 'Playback uses the generated full-score MP3.' : 'Audio is still loading.'}
          </Text>
          {activeMeasure !== null ? (
            <Text style={styles.measureHint}>Following measure {activeMeasure}</Text>
          ) : null}
          {audioError ? <Text style={styles.audioError}>{audioError}</Text> : null}
        </View>
      </View>

      {/* Annotation Toolbar */}
      <AnnotationToolbar
        currentTool={currentTool}
        currentColor={currentColor}
        currentStrokeWidth={currentStrokeWidth}
        enabled={annotationsEnabled}
        onToolChange={setCurrentTool}
        onColorChange={setCurrentColor}
        onStrokeWidthChange={setCurrentStrokeWidth}
        onClearAll={handleClearAllAnnotations}
        onToggleEnabled={() => setAnnotationsEnabled(!annotationsEnabled)}
      />

      <ScrollView
        ref={scrollViewRef}
        pagingEnabled
        horizontal
        style={styles.pageList}
        contentContainerStyle={styles.pageListContent}
        onMomentumScrollEnd={onMomentumScrollEnd}
        showsHorizontalScrollIndicator={false}
        scrollEnabled={!annotationsEnabled}
      >
        {pages.map((item) => (
          <View
            key={`${cacheToken}-${item.page_number}`}
            style={[
              styles.pageWrapper,
              {
                width,
                paddingHorizontal: pageHorizontalPadding,
                paddingBottom: pageVerticalPadding,
              },
            ]}
          >
            <View
              style={[
                styles.pageCard,
                {
                  minHeight: availablePageHeight,
                  padding: isTabletLayout ? 20 : 14,
                },
              ]}
            >
              <Text style={styles.pageLabel}>Page {item.page_number}</Text>
              {(() => {
                const range = measurePageRanges[item.page_number - 1];
                const isActiveRange =
                  range &&
                  activeMeasure !== null &&
                  activeMeasure >= range.startMeasure &&
                  activeMeasure <= range.endMeasure;
                const measuresOnPage = range ? Math.max(1, range.endIndex - range.startIndex + 1) : 1;
                const activeIndexWithinPage =
                  isActiveRange && range ? activeMeasure - range.startMeasure : 0;
                const bandTopPercent =
                  range && isActiveRange ? (activeIndexWithinPage / measuresOnPage) * 100 : 0;
                const bandHeightPercent = Math.max(12, 100 / measuresOnPage);

                return (
                  <>
                    {range ? (
                      <Text style={styles.measureRangeLabel}>
                        Measures {range.startMeasure}-{range.endMeasure}
                      </Text>
                    ) : null}
                    {isActiveRange ? (
                      <View
                        pointerEvents="none"
                        style={[
                          styles.measureOverlay,
                          {
                            top: `${Math.min(88, bandTopPercent)}%`,
                            height: `${Math.min(28, bandHeightPercent)}%`,
                          },
                        ]}
                      />
                    ) : null}
                  </>
                );
              })()}
              <Image
                source={{ uri: item.uri }}
                style={[
                  styles.pageImage,
                  {
                    minHeight: availablePageHeight - (isTabletLayout ? 80 : 70),
                  },
                ]}
                resizeMode="contain"
              />

              {/* Annotation Layer */}
              <AnnotationLayer
                pageNumber={item.page_number}
                width={width - pageHorizontalPadding * 2 - (isTabletLayout ? 40 : 28)}
                height={availablePageHeight - (isTabletLayout ? 80 : 70)}
                annotations={annotations}
                currentTool={currentTool}
                currentColor={currentColor}
                currentStrokeWidth={currentStrokeWidth}
                onAnnotationCreated={handleAnnotationCreated}
                onAnnotationUpdated={handleAnnotationUpdated}
                enabled={annotationsEnabled && currentPage === item.page_number - 1}
              />
            </View>
          </View>
        ))}
      </ScrollView>

      <View
        style={[
          styles.controlsContainer,
          {
            paddingHorizontal: isTabletLayout ? 36 : 24,
            paddingVertical: isTabletLayout ? 22 : 18,
          },
        ]}
      >
        <TouchableOpacity
          style={[
            styles.controlButton,
            isTabletLayout && styles.controlButtonTablet,
            currentPage === 0 && styles.disabledButton,
          ]}
          disabled={currentPage === 0}
          onPress={() => goToPage(currentPage - 1)}
        >
          <FontAwesomeIcon icon={faBackward} size={26} color={COLORS.darkBrown} />
        </TouchableOpacity>

        <View style={styles.pageInfo}>
          <Text style={styles.pageInfoText}>
            Page {Math.min(currentPage + 1, pages.length)} of {pages.length}
          </Text>
        </View>

        <TouchableOpacity
          style={[
            styles.controlButton,
            isTabletLayout && styles.controlButtonTablet,
            currentPage >= pages.length - 1 && styles.disabledButton,
          ]}
          disabled={currentPage >= pages.length - 1}
          onPress={() => goToPage(currentPage + 1)}
        >
          <FontAwesomeIcon icon={faForward} size={26} color={COLORS.darkBrown} />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.beige,
  },
  headerCard: {
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 10,
    padding: 18,
    backgroundColor: '#F2ECE2',
    borderRadius: 14,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  headerTitleWrap: {
    flex: 1,
  },
  scoreTitle: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 28,
    color: COLORS.darkBrown,
  },
  scoreSubtitle: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 16,
    color: COLORS.lightBrown,
    marginTop: 6,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.beige,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    marginLeft: 12,
  },
  shareButtonText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 16,
    color: COLORS.darkBrown,
  },
  audioRow: {
    marginTop: 14,
  },
  audioButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.darkBrown,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  audioButtonDisabled: {
    opacity: 0.5,
  },
  audioButtonText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 18,
    color: COLORS.beige,
  },
  audioHint: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 15,
    color: COLORS.lightBrown,
    marginTop: 8,
  },
  measureHint: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 16,
    color: COLORS.darkBrown,
    marginTop: 6,
  },
  audioError: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 15,
    color: '#A54C36',
    marginTop: 6,
  },
  webAudioElement: {
    width: '100%',
    marginBottom: 10,
  },
  pageList: {
    flex: 1,
  },
  pageListContent: {
    alignItems: 'stretch',
  },
  pageWrapper: {
    flex: 1,
    justifyContent: 'center',
  },
  pageCard: {
    position: 'relative',
    flex: 1,
    backgroundColor: '#FFFDF8',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2D6C8',
    justifyContent: 'flex-start',
    alignItems: 'center',
    padding: 14,
  },
  pageLabel: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 18,
    color: COLORS.lightBrown,
    marginBottom: 10,
  },
  measureRangeLabel: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 15,
    color: COLORS.darkBrown,
    marginBottom: 8,
  },
  measureOverlay: {
    position: 'absolute',
    left: 10,
    right: 10,
    top: 52,
    backgroundColor: 'rgba(255, 214, 10, 0.18)',
    borderColor: 'rgba(196, 148, 0, 0.45)',
    borderWidth: 2,
    borderRadius: 16,
    zIndex: 2,
  },
  pageImage: {
    width: '100%',
    flex: 1,
    minHeight: 320,
  },
  controlsContainer: {
    backgroundColor: COLORS.lightBrown,
    paddingHorizontal: 24,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  controlButton: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: COLORS.beige,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlButtonTablet: {
    width: 68,
    height: 68,
    borderRadius: 34,
  },
  disabledButton: {
    opacity: 0.45,
  },
  pageInfo: {
    flex: 1,
    alignItems: 'center',
  },
  pageInfoText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 20,
    color: COLORS.beige,
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  loadingText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 22,
    color: COLORS.darkBrown,
    marginTop: 18,
    textAlign: 'center',
  },
  errorText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 16,
    color: COLORS.lightBrown,
    marginTop: 10,
    textAlign: 'center',
  },
});
