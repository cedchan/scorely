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
  faArrowLeft,
  faBackward,
  faEdit,
  faForward,
  faMusic,
  faPause,
  faPlay,
  faShare,
} from '@fortawesome/free-solid-svg-icons';
import AnnotationLayer from '../components/AnnotationLayer';
import AnnotationToolbar from '../components/AnnotationToolbar';
import annotationSyncService from '../services/annotationSync';
import { 
  FilesetResolver, 
  FaceLandmarker 
} from '@mediapipe/tasks-vision';
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

export default function PlayerScreen({ route, navigation }) {
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
  // Nod state
  const [nodEnabled, setNodEnabled] = useState(false);
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
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const faceLandmarkerRef = useRef(null);
  const animationFrameRef = useRef(null);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const nodPhaseRef = useRef('idle');
  const lastTurnTimeRef = useRef(0);
  const baselineRelativeYRef = useRef(null);
  const currentPageRef = useRef(0);
  const jobId = route.params?.jobId;
  const apiBaseUrl = route.params?.apiBaseUrl || getFallbackApiBaseUrl();
  const pageManifestPath = route.params?.pageManifestPath || (jobId ? `/api/score-pages/${jobId}` : null);
  const cacheToken = jobId || route.params?.fileName || 'score';
  const isTabletLayout = width >= 900;
  const pageHorizontalPadding = isTabletLayout ? 56 : 20;
  const pageVerticalPadding = isTabletLayout ? 24 : 16;
  const controlsHeight = isTabletLayout ? 108 : 94;
  const compactHeaderHeight = 48; // Much more compact header
  const availablePageHeight = Math.max(
    320,
    height - compactHeaderHeight - controlsHeight - pageVerticalPadding * 2
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
    currentPageRef.current = currentPage;
  }, [currentPage]);
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
      setAnnotations((prev) => {
        const exists = prev.some((a) => a.id === annotation.id);
        if (exists) {
          return prev.map((a) => (a.id === annotation.id ? annotation : a));
        } else {
          return [...prev, annotation];
        }
      });
    };
    const handleAnnotationDeleted = ({ annotationId }) => {
      setAnnotations((prev) => prev.filter((a) => a.id !== annotationId));
    };

    const handleError = ({ error }) => {
      console.error('Annotation sync error:', error);
    };

    const handleTitleUpdated = ({ title: newTitle }) => {
      setTitle(newTitle);
    };

    annotationSyncService.on('sync_response', handleSyncResponse);
    annotationSyncService.on('annotation_added', handleAnnotationAdded);
    annotationSyncService.on('annotation_updated', handleAnnotationUpdated);
    annotationSyncService.on('annotation_deleted', handleAnnotationDeleted);
    annotationSyncService.on('title_updated', handleTitleUpdated);
    annotationSyncService.on('error', handleError);

    // Cleanup
    return () => {
      annotationSyncService.off('sync_response', handleSyncResponse);
      annotationSyncService.off('annotation_added', handleAnnotationAdded);
      annotationSyncService.off('annotation_updated', handleAnnotationUpdated);
      annotationSyncService.off('annotation_deleted', handleAnnotationDeleted);
      annotationSyncService.off('title_updated', handleTitleUpdated);
      annotationSyncService.off('error', handleError);
      annotationSyncService.disconnect();
    };
  }, [apiBaseUrl, jobId, userId]);
  useEffect(() => {
    console.log('camera effect running', { platform: Platform.OS, nodEnabled });
    if (Platform.OS !== 'web') return;
  
    let cancelled = false;
  
    const stopCamera = () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
  
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
  
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
  
      faceLandmarkerRef.current = null;
      setCameraEnabled(false);
      nodPhaseRef.current = 'idle';
      lastTurnTimeRef.current = 0;
      baselineRelativeYRef.current = null;
    };
  
    const startCameraAndTracking = async () => {
      if (!nodEnabled) {
        stopCamera();
        return;
      }
      console.log('about to request camera');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: false,
        });
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        );
  
        const faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
          },
          runningMode: 'VIDEO',
          numFaces: 1,
        });
  
        faceLandmarkerRef.current = faceLandmarker;
  
        if (cancelled) return;
  
        streamRef.current = stream;
  
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
  
        if (cancelled) return;
  
        setCameraEnabled(true);
  
        const detectFrame = () => {
          if (
            cancelled ||
            !videoRef.current ||
            !faceLandmarkerRef.current ||
            videoRef.current.readyState < 2
          ) {
            animationFrameRef.current = requestAnimationFrame(detectFrame);
            return;
          }
  
          const results = faceLandmarkerRef.current.detectForVideo(
            videoRef.current,
            performance.now()
          );
  
          const face = results.faceLandmarks?.[0];
  
          if (face) {
            const nose = face[1];
            const leftEye = face[33];
            const rightEye = face[263];
          
            if (nose && leftEye && rightEye) {
              const eyeY = (leftEye.y + rightEye.y) / 2;
          
              console.log(
                'face detected',
                'noseY:', nose.y,
                'leftEyeY:', leftEye.y,
                'rightEyeY:', rightEye.y,
                'eyeY:', eyeY
              );
          
              handleNodDetection(nose.y, eyeY);
            }
          }
  
          animationFrameRef.current = requestAnimationFrame(detectFrame);
        };
  
        detectFrame();
      } catch (err) {
        console.error('Camera / face tracking error:', err?.name, err?.message, err);
        stopCamera();
      }
    };
  
    startCameraAndTracking();
  
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [nodEnabled]);
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
  const handleNodDetection = (noseY, eyeY) => {
    const relativeY = noseY - eyeY;
    const now = Date.now();
    const downThreshold = 0.01;
    const upThreshold = 0.004;
    const cooldownMs = 1200;
  
    if (baselineRelativeYRef.current === null) {
      baselineRelativeYRef.current = relativeY;
      return;
    }
  
    const delta = relativeY - baselineRelativeYRef.current;
  
    console.log(
      'nod check',
      'relativeY:', relativeY,
      'baseline:', baselineRelativeYRef.current,
      'delta:', delta,
      'nodPhase:', nodPhaseRef.current,
      'lastTurnTime:', lastTurnTimeRef.current
    );
  
    if (now - lastTurnTimeRef.current < cooldownMs) {
      return;
    }
  
    if (nodPhaseRef.current === 'idle' && delta > downThreshold) {
      nodPhaseRef.current = 'down';
      return;
    }
  
    if (nodPhaseRef.current === 'down' && delta < upThreshold) {
      nodPhaseRef.current = 'idle';
      lastTurnTimeRef.current = now;
  
      if (currentPageRef.current < pages.length - 1) {
        goToPage(currentPageRef.current + 1);
      }
    }
  
    baselineRelativeYRef.current =
      baselineRelativeYRef.current * 0.9 + relativeY * 0.1;
  };
  const onMomentumScrollEnd = (event) => {
    const nextPage = Math.round(event.nativeEvent.contentOffset.x / width);
    setCurrentPage(nextPage);
  };

  const onScroll = (event) => {
    // For web compatibility, update page number on scroll as well
    if (Platform.OS === 'web') {
      const nextPage = Math.round(event.nativeEvent.contentOffset.x / width);
      if (nextPage !== currentPage) {
        setCurrentPage(nextPage);
      }
    }
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
    // If this is a final annotation (after live updates), replace the temporary one
    if (annotation._isFinal) {
      // Send final version to server
      annotationSyncService.addAnnotation(annotation);

      // Replace temporary with final in local state
      setAnnotations((prev) => {
        const withoutTemp = prev.filter((a) => a.id !== annotation.id);
        return [...withoutTemp, annotation];
      });
    } else {
      // Regular annotation creation (no live updates)
      annotationSyncService.addAnnotation(annotation);
      setAnnotations((prev) => [...prev, annotation]);
    }
  };

  const handleAnnotationUpdated = (annotation) => {
    // Check if this is a deletion (marked with _deleted flag)
    if (annotation._deleted) {
      annotationSyncService.deleteAnnotation(annotation.id);
      setAnnotations((prev) => prev.filter((a) => a.id !== annotation.id));
    } else if (annotation._isTemp) {
      // This is a temporary live update - send to WebSocket but handle locally
      annotationSyncService.updateAnnotation(annotation);

      // Add or update in local state
      setAnnotations((prev) => {
        const exists = prev.some((a) => a.id === annotation.id);
        if (exists) {
          return prev.map((a) => (a.id === annotation.id ? annotation : a));
        } else {
          return [...prev, annotation];
        }
      });
    } else {
      // Regular update
      annotationSyncService.updateAnnotation(annotation);
      setAnnotations((prev) =>
        prev.map((a) => (a.id === annotation.id ? annotation : a))
      );
    }
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

  const handleRename = async () => {
    if (!jobId) {
      alert('Cannot rename: No job ID available');
      return;
    }

    const newTitle = prompt('Enter new title for this score:', title);
    if (!newTitle || newTitle === title) {
      return;
    }

    try {
      const response = await fetch(`${apiBaseUrl}/api/score/${jobId}/title`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: newTitle }),
      });

      if (response.ok) {
        setTitle(newTitle);
      } else {
        const data = await response.json();
        alert(`Failed to rename: ${data.detail || 'Unknown error'}`);
      }
    } catch (error) {
      alert(`Error renaming score: ${error.message}`);
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
      {Platform.OS === 'web' ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ display: 'none' }}
        />
      ) : null}

      {/* Hidden audio element */}
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
          style={{ display: 'none' }}
        />
      ) : null}

      {/* Compact Header with Back Button, Title, Edit, Play, and Share */}
      <View style={styles.compactHeader}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <FontAwesomeIcon icon={faArrowLeft} size={20} color={COLORS.beige} />
        </TouchableOpacity>
        <View style={styles.titleSection}>
          <Text style={styles.compactTitle} numberOfLines={1}>{title}</Text>
          <TouchableOpacity onPress={handleRename} style={styles.editButton}>
            <FontAwesomeIcon icon={faEdit} size={16} color={COLORS.darkBrown} />
          </TouchableOpacity>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={[styles.compactPlayButton, !audioUrl && styles.compactPlayButtonDisabled]}
            onPress={togglePlayback}
            disabled={!audioUrl}
          >
            <FontAwesomeIcon
              icon={isPlaying ? faPause : faPlay}
              size={16}
              color={COLORS.beige}
            />
          </TouchableOpacity>
          <TouchableOpacity style={styles.compactShareButton} onPress={handleShare}>
            <FontAwesomeIcon icon={faShare} size={16} color={COLORS.darkBrown} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Annotation Toolbar */}
      <View style={styles.toolbarRow}>
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

        <View style={styles.rightButtons}>
          <TouchableOpacity
            style={[styles.gestureButton, nodEnabled && styles.gestureButtonActive]}
            onPress={() => {
              console.log('nod button clicked');
              setNodEnabled(!nodEnabled);
            }}          >
            <Text
              style={[
                styles.gestureButtonText,
                nodEnabled && styles.gestureButtonTextActive
              ]}
            >
              Nod to Turn Page
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        ref={scrollViewRef}
        pagingEnabled
        horizontal
        style={styles.pageList}
        contentContainerStyle={styles.pageListContent}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={onMomentumScrollEnd}
        showsHorizontalScrollIndicator={false}
        scrollEnabled={!annotationsEnabled}
      >
        {pages.map((item) => {
          const containerWidth = width - pageHorizontalPadding * 2 - (isTabletLayout ? 40 : 28);
          const containerHeight = availablePageHeight - (isTabletLayout ? 80 : 70);
          
          const imageWidth = item.width || 1240;
          const imageHeight = item.height || 1754;
          
          const scale = Math.min(containerWidth / imageWidth, containerHeight / imageHeight);
          const displayedWidth = imageWidth * scale;
          const displayedHeight = imageHeight * scale;

          return (
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

                      <View style={styles.imageContainer}>
                        <Image
                          source={{ uri: item.uri }}
                          style={[
                            styles.pageImage,
                            {
                              width: displayedWidth,
                              height: displayedHeight,
                            },
                          ]}
                          resizeMode="contain"
                        />

                        {isActiveRange ? (
                          <View
                            pointerEvents="none"
                            style={[
                              styles.measureOverlay,
                              {
                                top: `${Math.min(88, bandTopPercent)}%`,
                                height: `${Math.min(28, bandHeightPercent)}%`,
                                width: displayedWidth,
                              },
                            ]}
                          />
                        ) : null}

                        {/* Annotation Layer */}
                        <AnnotationLayer
                          pageNumber={item.page_number}
                          width={displayedWidth}
                          height={displayedHeight}
                          annotations={annotations}
                          currentTool={currentTool}
                          currentColor={currentColor}
                          currentStrokeWidth={currentStrokeWidth}
                          onAnnotationCreated={handleAnnotationCreated}
                          onAnnotationUpdated={handleAnnotationUpdated}
                          enabled={annotationsEnabled && currentPage === item.page_number - 1}
                        />
                      </View>
                    </>
                  );
                })()}
              </View>
            </View>
          );
        })}
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
  compactHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.lightBrown,
    paddingHorizontal: 16,
    paddingVertical: 12,
    height: 48,
    gap: 12,
  },
  backButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  compactTitle: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 18,
    color: COLORS.beige,
    flex: 1,
  },
  editButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.beige,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  compactPlayButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.darkBrown,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactPlayButtonDisabled: {
    opacity: 0.5,
  },
  compactShareButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.beige,
    alignItems: 'center',
    justifyContent: 'center',
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
    position: 'relative',
  },
  imageContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    width: '100%',
    flex: 1,
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
  toolbarRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginBottom: 10,
    backgroundColor: COLORS.lightBrown,
  },
  
  gestureButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.beige,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  
  gestureButtonText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 16,
    color: COLORS.darkBrown,
  },
  gestureButtonActive: {
    backgroundColor: COLORS.darkBrown,   
  },
  
  gestureButtonTextActive: {
    color: COLORS.beige,  
  },
  testButton: {
    marginLeft: 10,
    backgroundColor: '#C8B8A6',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  
  testButtonText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 14,
    color: '#58392F',
  },
  rightButtons: {
    flexDirection: 'row',  
    alignItems: 'center',
  },
});
