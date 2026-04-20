import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useFonts, Afacad_400Regular } from '@expo-google-fonts/afacad';
import { SvgUri, SvgXml } from 'react-native-svg';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import {
  faArrowLeft,
  faBackward,
  faChevronDown,
  faChevronLeft,
  faChevronRight,
  faCopy,
  faEdit,
  faForward,
  faMusic,
  faPause,
  faPlay,
} from '@fortawesome/free-solid-svg-icons';
import AnnotationLayer from '../components/AnnotationLayer';
import AnnotationToolbar from '../components/AnnotationToolbar';
import annotationSyncService from '../services/annotationSync';
import { getApiBaseUrl } from '../services/apiBaseUrl';
import { initializeUserIdentity } from '../services/userIdentity';
import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';
import { config } from '../config';

const COLORS = {
  beige: '#FAF7F0',
  lightBrown: '#A9988F',
  darkBrown: '#58392F',
};

const MEDIAPIPE_VERSION = '0.10.34';
const PLAYBACK_HIGHLIGHT_LEAD_SECONDS = 0.18;

export default function PlayerScreen({ route, navigation }) {
  const { width, height } = useWindowDimensions();
  const scrollViewRef = useRef(null);
  const webAudioRef = useRef(null);
  const audioPollTimerRef = useRef(null);
  const playbackAnimationFrameRef = useRef(null);
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
  const [activeMeasureIndex, setActiveMeasureIndex] = useState(null);
  const [pageTurnMode, setPageTurnMode] = useState('manual');
  const [showPageTurnMenu, setShowPageTurnMenu] = useState(false);
  const [backwardMotion, setBackwardMotion] = useState('manual');
  const [forwardMotion, setForwardMotion] = useState('manual');
  const [showBackwardMenu, setShowBackwardMenu] = useState(false);
  const [showForwardMenu, setShowForwardMenu] = useState(false);
  const [annotations, setAnnotations] = useState([]);
  const [annotationsEnabled, setAnnotationsEnabled] = useState(false);
  const [currentTool, setCurrentTool] = useState('pen');
  const [currentColor, setCurrentColor] = useState('#D94848');
  const [currentStrokeWidth, setCurrentStrokeWidth] = useState(4);
  const [userId, setUserId] = useState('');
  const [username, setUsername] = useState('');
  const [shareCode, setShareCode] = useState(null);
  const [presentUsers, setPresentUsers] = useState([]);
  const [selectedPresenceUser, setSelectedPresenceUser] = useState(null);
  const [hiddenAnnotationUsers, setHiddenAnnotationUsers] = useState(new Set());
  const [showUserVisibilityDropdown, setShowUserVisibilityDropdown] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const faceLandmarkerRef = useRef(null);
  const animationFrameRef = useRef(null);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const nodPhaseRef = useRef('idle');
  const lastTurnTimeRef = useRef(0);
  const baselineRelativeYRef = useRef(null);
  const currentPageRef = useRef(0);
  const [debugInfo, setDebugInfo] = useState('');
  const updateMeasureFromTimeRef = useRef(() => {});
  const jobId = route.params?.jobId;
  const apiBaseUrl = route.params?.apiBaseUrl || getApiBaseUrl();
  const pageManifestPath =
    route.params?.pageManifestPath || (jobId ? `/api/score-pages/${jobId}` : null);
  const cacheToken = jobId || route.params?.fileName || 'score';
  const isTabletLayout = width >= 900;
  const pageHorizontalPadding = isTabletLayout ? 56 : 20;
  const pageVerticalPadding = isTabletLayout ? 24 : 16;
  const pageTopPadding = isTabletLayout ? 32 : 24;
  const controlsHeight = isTabletLayout ? 70 : 60;
  const compactHeaderHeight = 56;
  const toolbarHeight = 58;
  const availablePageHeight = Math.max(
    320,
    height -
      compactHeaderHeight -
      toolbarHeight -
      controlsHeight -
      pageVerticalPadding -
      pageTopPadding
  );
  const nodEnabled = pageTurnMode === 'nod';

  const measureRegionLookup = useMemo(() => {
    const lookup = new Map();
    pages.forEach((page, pageIndex) => {
      (page.measure_regions || []).forEach((region) => {
        const regionIndex = Number(region.measure_index);
        if (!Number.isFinite(regionIndex) || lookup.has(regionIndex)) {
          return;
        }
        lookup.set(regionIndex, {
          ...region,
          pageIndex,
          pageNumber: page.page_number,
        });
      });
    });
    return lookup;
  }, [pages]);

  const measurePageRanges = useMemo(() => {
    if (measureRegionLookup.size || !pages.length || !alignmentMappings.length) {
      return [];
    }
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
  }, [alignmentMappings, measureRegionLookup, pages]);

  const measureTimeLookup = useMemo(() => {
    const lookup = new Map();
    alignmentMappings.forEach((mapping, index) => {
      const parsedIndex = Number(mapping.measure_index);
      const measureIndex = Number.isFinite(parsedIndex) ? parsedIndex : index;
      if (!lookup.has(measureIndex)) {
        lookup.set(measureIndex, Number(mapping.time_seconds) || 0);
      }
    });
    return lookup;
  }, [alignmentMappings]);

  const [fontsLoaded] = useFonts({
    Afacad_400Regular,
  });

  useEffect(() => {
    initializeUserIdentity().then(({ userId, username }) => {
      setUserId(userId);
      setUsername(username);
    });
  }, []);

  const normalizePageMeasureRegions = (pageList = []) => {
    let fallbackMeasureIndex = 0;
    return pageList.map((page) => {
      const measureRegions = (page.measure_regions || []).map((region) => {
        const parsedIndex = Number(region.measure_index);
        const measureIndex = Number.isFinite(parsedIndex) ? parsedIndex : fallbackMeasureIndex;
        fallbackMeasureIndex = Math.max(fallbackMeasureIndex + 1, measureIndex + 1);
        return {
          ...region,
          measure_index: measureIndex,
        };
      });
      return {
        ...page,
        measure_regions: measureRegions,
      };
    });
  };

  const injectHighlightIntoSvg = (svgXml, region) => {
    if (!svgXml || !region) {
      return svgXml;
    }
    const rectX = region.x * 21000;
    const rectY = region.y * 29700;
    const rectWidth = region.width * 21000;
    const rectHeight = region.height * 29700;
    const highlightRect = [
      `<rect x="${rectX}" y="${rectY}" width="${rectWidth}" height="${rectHeight}"`,
      ' fill="#FFD60A"',
      ' fill-opacity="0.18"',
      ' stroke="#C49400"',
      ' stroke-opacity="0.45"',
      ' stroke-width="48"',
      ' />',
    ].join('');
    return svgXml.replace(
      /(<svg[^>]*class="definition-scale"[^>]*>)([\s\S]*?)(<\/svg>)/,
      `$1$2${highlightRect}$3`
    );
  };

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
        const normalizedPages = normalizePageMeasureRegions(data.pages || []);
        const hydratedPages = await Promise.all(
          normalizedPages.map(async (page) => {
            const pageUri = `${apiBaseUrl}${page.image_path}?job=${encodeURIComponent(
              cacheToken
            )}&page=${page.page_number}`;
            const isSvgPage = String(page.image_path || '').toLowerCase().includes('.svg');
            let svgXml = null;

            if (isSvgPage) {
              try {
                const svgResponse = await fetch(pageUri);
                if (svgResponse.ok) {
                  svgXml = await svgResponse.text();
                }
              } catch {
                svgXml = null;
              }
            }

            return {
              ...page,
              uri: pageUri,
              svgXml,
            };
          })
        );

        setPages(hydratedPages);
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
      } catch {
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

        setAlignmentMappings(
          (data.mappings || []).map((mapping, index) => {
            const parsedIndex = Number(mapping.measure_index);
            return {
              ...mapping,
              measure_index: Number.isFinite(parsedIndex) ? parsedIndex : index,
            };
          })
        );
      } catch {
        setAlignmentMappings([]);
      }
    };

    loadAlignment();
  }, [apiBaseUrl, jobId]);

  useEffect(() => {
    stopPlaybackHighlightSync();
    setIsPlaying(false);
    setActiveMeasure(null);
    setActiveMeasureIndex(null);
  }, [playbackUrl]);

  useEffect(() => {
    if (!jobId || !userId || !username) return;

    annotationSyncService.connect(apiBaseUrl, jobId, userId, username);

    const handleSyncResponse = ({ annotations: syncedAnnotations }) => {
      setAnnotations(syncedAnnotations);
    };

    const handleAnnotationAdded = ({ annotation }) => {
      setAnnotations((prev) => {
        if (prev.some((a) => a.id === annotation.id)) {
          return prev;
        }
        return [...prev, annotation];
      });
    };

    const handleAnnotationUpdated = ({ annotation }) => {
      console.log('[PlayerScreen] handleAnnotationUpdated called with:', {
        id: annotation.id,
        _isTemp: annotation._isTemp,
        _isFinal: annotation._isFinal,
        user_id: annotation.user_id,
      });

      setAnnotations((prev) => {
        const exists = prev.some((a) => a.id === annotation.id);

        // Only keep _isTemp flag if explicitly set to true
        const isTemp = annotation._isTemp === true;
        const isFinal = annotation._isFinal === true;

        console.log('[PlayerScreen] Processing annotation:', {
          id: annotation.id,
          exists,
          isTemp,
          isFinal,
        });

        if (exists) {
          const updated = prev.map((a) => {
            if (a.id === annotation.id) {
              if (isFinal) {
                // Final version, remove temp flags
                const { _isTemp, _isFinal, ...finalAnnotation } = annotation;
                console.log('[PlayerScreen] Finalizing annotation:', annotation.id);
                return finalAnnotation;
              } else if (isTemp) {
                // Live update, keep temp flag
                console.log('[PlayerScreen] Keeping temp flag for:', annotation.id);
                return { ...annotation, _isTemp: true };
              } else {
                // No special flags, just update normally (removes _isTemp)
                const { _isTemp: removedTemp, ...cleanAnnotation } = annotation;
                console.log('[PlayerScreen] Removing temp flag from:', annotation.id);
                return cleanAnnotation;
              }
            }
            return a;
          });
          console.log('[PlayerScreen] After update, annotation state:', updated.find(a => a.id === annotation.id));
          return updated;
        }

        // New annotation
        if (isFinal) {
          const { _isTemp, _isFinal, ...finalAnnotation } = annotation;
          console.log('[PlayerScreen] Adding new final annotation:', annotation.id);
          return [...prev, finalAnnotation];
        } else if (isTemp) {
          console.log('[PlayerScreen] Adding new temp annotation:', annotation.id);
          return [...prev, { ...annotation, _isTemp: true }];
        } else {
          // New annotation without flags - don't add _isTemp
          console.log('[PlayerScreen] Adding new annotation without flags:', annotation.id);
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

    const handlePresenceUpdate = ({ users }) => {
      const otherUsers = users.filter((u) => u.user_id !== userId);
      setPresentUsers(otherUsers);
    };

    const handleUserJoined = ({ userId: joinedUserId, username: joinedUsername }) => {
      if (joinedUserId !== userId) {
        setPresentUsers((prev) => {
          if (prev.some((u) => u.user_id === joinedUserId)) {
            return prev;
          }
          return [...prev, { user_id: joinedUserId, username: joinedUsername }];
        });
      }
    };

    const handleUserLeft = ({ userId: leftUserId }) => {
      setPresentUsers((prev) => prev.filter((u) => u.user_id !== leftUserId));
    };

    annotationSyncService.on('sync_response', handleSyncResponse);
    annotationSyncService.on('annotation_added', handleAnnotationAdded);
    annotationSyncService.on('annotation_updated', handleAnnotationUpdated);
    annotationSyncService.on('annotation_deleted', handleAnnotationDeleted);
    annotationSyncService.on('title_updated', handleTitleUpdated);
    annotationSyncService.on('presence_update', handlePresenceUpdate);
    annotationSyncService.on('user_joined', handleUserJoined);
    annotationSyncService.on('user_left', handleUserLeft);
    annotationSyncService.on('error', handleError);

    return () => {
      annotationSyncService.off('sync_response', handleSyncResponse);
      annotationSyncService.off('annotation_added', handleAnnotationAdded);
      annotationSyncService.off('annotation_updated', handleAnnotationUpdated);
      annotationSyncService.off('annotation_deleted', handleAnnotationDeleted);
      annotationSyncService.off('title_updated', handleTitleUpdated);
      annotationSyncService.off('presence_update', handlePresenceUpdate);
      annotationSyncService.off('user_joined', handleUserJoined);
      annotationSyncService.off('user_left', handleUserLeft);
      annotationSyncService.off('error', handleError);
      annotationSyncService.disconnect();
    };
  }, [apiBaseUrl, jobId, userId, username]);

  useEffect(() => {
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
        videoRef.current.pause?.();
        videoRef.current.srcObject = null;
      }

      faceLandmarkerRef.current?.close?.();
      faceLandmarkerRef.current = null;
      setCameraEnabled(false);
      nodPhaseRef.current = 'idle';
      lastTurnTimeRef.current = 0;
      baselineRelativeYRef.current = null;
    };

    const waitForVideoReady = (videoElement) =>
      new Promise((resolve, reject) => {
        if (videoElement.readyState >= 2 && videoElement.videoWidth > 0) {
          resolve();
          return;
        }

        const timeoutId = setTimeout(() => {
          cleanup();
          reject(new Error('Camera video did not become ready in time.'));
        }, 8000);

        const handleReady = () => {
          if (videoElement.videoWidth > 0) {
            cleanup();
            resolve();
          }
        };

        const handleError = () => {
          cleanup();
          reject(new Error('Unable to read frames from the camera video.'));
        };

        const cleanup = () => {
          clearTimeout(timeoutId);
          videoElement.removeEventListener('loadedmetadata', handleReady);
          videoElement.removeEventListener('canplay', handleReady);
          videoElement.removeEventListener('error', handleError);
        };

        videoElement.addEventListener('loadedmetadata', handleReady);
        videoElement.addEventListener('canplay', handleReady);
        videoElement.addEventListener('error', handleError);
      });

    const getCameraErrorMessage = (err) => {
      if (typeof window !== 'undefined' && !window.isSecureContext) {
        return 'Camera access on iPad Safari requires HTTPS or localhost. Open this page over HTTPS to use nod detection.';
      }
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        return 'Camera permission was denied. Allow camera access in Safari and try again.';
      }
      if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
        return 'No front camera was found for nod detection.';
      }
      if (err?.name === 'NotReadableError' || err?.name === 'TrackStartError') {
        return 'The camera is already in use by another app or tab.';
      }
      return err?.message || 'Unable to start the camera for nod detection.';
    };

    const requestCameraStream = async () => {
      try {
        return await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'user' },
            width: { ideal: 640 },
            height: { ideal: 480 },
          },
          audio: false,
        });
      } catch (error) {
        if (
          error?.name === 'OverconstrainedError' ||
          error?.name === 'ConstraintNotSatisfiedError'
        ) {
          return navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }
        throw error;
      }
    };

    const startCameraAndTracking = async () => {
      if (!nodEnabled) {
        setCameraError(null);
        stopCamera();
        return;
      }

      setCameraError(null);

      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('This browser does not support camera access for nod detection.');
        stopCamera();
        return;
      }

      if (typeof window !== 'undefined' && !window.isSecureContext) {
        setCameraError(
          'Camera access on iPad Safari requires HTTPS or localhost. Open this page over HTTPS to use nod detection.'
        );
        stopCamera();
        return;
      }

      try {
        const stream = await requestCameraStream();
        setDebugInfo('Loading AI model...');
        const vision = await FilesetResolver.forVisionTasks(
          `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`
        );
        setDebugInfo('Creating face detector...');

        const faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numFaces: 1,
          minFaceDetectionConfidence: 0.5,
          minFacePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        faceLandmarkerRef.current = faceLandmarker;

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          faceLandmarker.close?.();
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.muted = true;
          videoRef.current.autoplay = true;
          videoRef.current.playsInline = true;
          videoRef.current.setAttribute('muted', 'true');
          videoRef.current.setAttribute('autoplay', 'true');
          videoRef.current.setAttribute('playsinline', 'true');
          videoRef.current.setAttribute('webkit-playsinline', 'true');
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          await waitForVideoReady(videoRef.current);
        }

        if (cancelled) return;

        setCameraEnabled(true);

        const detectFrame = () => {
          if (cancelled) {
            return;
          }

          if (!videoRef.current || !faceLandmarkerRef.current) {
            animationFrameRef.current = requestAnimationFrame(detectFrame);
            return;
          }

          if (videoRef.current.readyState < 2) {
            animationFrameRef.current = requestAnimationFrame(detectFrame);
            return;
          }

          let results;
          try {
            results = faceLandmarkerRef.current.detectForVideo(videoRef.current, performance.now());
          } catch (err) {
            setDebugInfo(`Error: ${err.message}`);
            animationFrameRef.current = requestAnimationFrame(detectFrame);
            return;
          }

          const face = results.faceLandmarks?.[0];

          if (face) {
            const nose = face[1];
            const leftEye = face[33];
            const rightEye = face[263];

            if (nose && leftEye && rightEye) {
              const eyeY = (leftEye.y + rightEye.y) / 2;
              const relativeY = nose.y - eyeY;
              const delta =
                baselineRelativeYRef.current !== null ? relativeY - baselineRelativeYRef.current : 0;

              setDebugInfo(
                `✓ Face detected\nPhase: ${nodPhaseRef.current}\nDelta: ${delta.toFixed(
                  4
                )}\nBaseline: ${baselineRelativeYRef.current?.toFixed(4) || 'null'}`
              );

              handleNodDetection(nose.y, eyeY);
            } else {
              setDebugInfo('✓ Face detected (missing landmarks)');
            }
          } else {
            setDebugInfo('✗ No face detected\nCheck lighting & position');
          }

          animationFrameRef.current = requestAnimationFrame(detectFrame);
        };

        detectFrame();
      } catch (err) {
        if (!cancelled) {
          setCameraError(getCameraErrorMessage(err));
        }
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
    const { downThreshold, upThreshold, cooldownMs, baselineSmoothing } = config.nodDetection;

    if (baselineRelativeYRef.current === null) {
      baselineRelativeYRef.current = relativeY;
      return;
    }

    const delta = relativeY - baselineRelativeYRef.current;

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
      baselineRelativeYRef.current * baselineSmoothing + relativeY * (1 - baselineSmoothing);
  };

  const onMomentumScrollEnd = (event) => {
    const nextPage = Math.round(event.nativeEvent.contentOffset.x / width);
    setCurrentPage(nextPage);
  };

  const onScroll = (event) => {
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

    const effectiveTimeSeconds = Math.max(0, timeSeconds + PLAYBACK_HIGHLIGHT_LEAD_SECONDS);

    let nextIndex = 0;
    for (let index = 0; index < alignmentMappings.length; index += 1) {
      if (alignmentMappings[index].time_seconds <= effectiveTimeSeconds) {
        nextIndex = index;
      } else {
        break;
      }
    }

    const nextMeasure = alignmentMappings[nextIndex]?.measure ?? null;
    const nextMeasureIndex = alignmentMappings[nextIndex]?.measure_index ?? nextIndex;
    setActiveMeasure(nextMeasure);
    setActiveMeasureIndex(nextMeasureIndex);

    const exactMeasureRegion =
      nextMeasureIndex !== null ? measureRegionLookup.get(Number(nextMeasureIndex)) : null;

    if (
      pageTurnMode === 'auto' &&
      exactMeasureRegion &&
      exactMeasureRegion.pageIndex !== currentPageRef.current
    ) {
      goToPage(exactMeasureRegion.pageIndex);
      return;
    }

    const nextPageIndex = measurePageRanges.findIndex(
      (range) =>
        nextMeasure !== null &&
        nextMeasure >= range.startMeasure &&
        nextMeasure <= range.endMeasure
    );

    if (
      pageTurnMode === 'auto' &&
      nextPageIndex !== -1 &&
      nextPageIndex !== currentPageRef.current
    ) {
      goToPage(nextPageIndex);
    }
  };

  updateMeasureFromTimeRef.current = updateMeasureFromTime;

  const stopPlaybackHighlightSync = () => {
    if (playbackAnimationFrameRef.current) {
      cancelAnimationFrame(playbackAnimationFrameRef.current);
      playbackAnimationFrameRef.current = null;
    }
  };

  const startPlaybackHighlightSync = () => {
    stopPlaybackHighlightSync();

    const syncPlaybackHighlight = () => {
      const audioElement = webAudioRef.current;
      if (!audioElement) {
        playbackAnimationFrameRef.current = null;
        return;
      }

      updateMeasureFromTimeRef.current(audioElement.currentTime);

      if (!audioElement.paused && !audioElement.ended) {
        playbackAnimationFrameRef.current = requestAnimationFrame(syncPlaybackHighlight);
      } else {
        playbackAnimationFrameRef.current = null;
      }
    };

    syncPlaybackHighlight();
  };

  const seekToMeasureRegion = (region, pageIndex) => {
    if (!region) {
      return;
    }

    const regionMeasureIndex = Number(region.measure_index);
    const regionMeasure = Number(region.measure);
    const nextMeasureIndex = Number.isFinite(regionMeasureIndex) ? regionMeasureIndex : null;
    const nextMeasure = Number.isFinite(regionMeasure) ? regionMeasure : null;

    if (typeof pageIndex === 'number' && pageIndex !== currentPageRef.current) {
      goToPage(pageIndex);
    }

    setActiveMeasure(nextMeasure);
    setActiveMeasureIndex(nextMeasureIndex);

    if (Platform.OS !== 'web') {
      return;
    }

    const audioElement = webAudioRef.current;
    if (!audioElement || nextMeasureIndex === null) {
      return;
    }

    const targetTime = measureTimeLookup.get(nextMeasureIndex);
    if (!Number.isFinite(targetTime)) {
      return;
    }

    try {
      audioElement.currentTime = Math.max(0, targetTime);
    } catch {
      return;
    }

    updateMeasureFromTime(targetTime - PLAYBACK_HIGHLIGHT_LEAD_SECONDS);

    if (!audioElement.paused && !audioElement.ended) {
      startPlaybackHighlightSync();
    }
  };

  useEffect(() => {
    return () => {
      stopPlaybackHighlightSync();
    };
  }, []);

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
      setAudioError(playbackError?.message || 'Unable to start playback. Try pressing play again.');
      setIsPlaying(false);
    }
  };

  const handleAnnotationCreated = (annotation) => {
    if (annotation._isFinal) {
      annotationSyncService.addAnnotation(annotation);
      setAnnotations((prev) => {
        const withoutTemp = prev.filter((a) => a.id !== annotation.id);
        return [...withoutTemp, annotation];
      });
    } else {
      annotationSyncService.addAnnotation(annotation);
      setAnnotations((prev) => [...prev, annotation]);
    }
  };

  const handleAnnotationUpdated = (annotation) => {
    if (annotation._deleted) {
      annotationSyncService.deleteAnnotation(annotation.id);
      setAnnotations((prev) => prev.filter((a) => a.id !== annotation.id));
    } else if (annotation._isTemp) {
      annotationSyncService.updateAnnotation(annotation);
      setAnnotations((prev) => {
        const exists = prev.some((a) => a.id === annotation.id);
        if (exists) {
          return prev.map((a) => (a.id === annotation.id ? annotation : a));
        }
        return [...prev, annotation];
      });
    } else {
      annotationSyncService.updateAnnotation(annotation);
      setAnnotations((prev) => prev.map((a) => (a.id === annotation.id ? annotation : a)));
    }
  };

  const handleClearAllAnnotations = () => {
    const pageAnnotations = annotations.filter((ann) => ann.page_number === currentPage + 1);

    pageAnnotations.forEach((ann) => {
      annotationSyncService.deleteAnnotation(ann.id);
    });

    setAnnotations((prev) => prev.filter((ann) => ann.page_number !== currentPage + 1));
  };

  useEffect(() => {
    const loadShareCode = async () => {
      if (!jobId) {
        return;
      }

      try {
        const response = await fetch(`${apiBaseUrl}/api/share/${jobId}`, {
          method: 'POST',
        });
        const data = await response.json();

        if (response.ok) {
          setShareCode(data.share_code);
        }
      } catch (error) {
        console.error('Error loading share code:', error);
      }
    };

    loadShareCode();
  }, [apiBaseUrl, jobId]);

  const copyShareCode = async () => {
    if (!shareCode) return;

    if (Platform.OS === 'web') {
      try {
        await navigator.clipboard.writeText(shareCode);
        alert('Share code copied to clipboard!');
      } catch {
        alert('Failed to copy to clipboard');
      }
    } else {
      alert(`Share code: ${shareCode}`);
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

  const handleSelectPageTurnMode = (mode) => {
    setPageTurnMode(mode);
    setShowPageTurnMenu(false);
    setCameraError(null);
  };

  const getPageTurnLabel = () => {
    switch (pageTurnMode) {
      case 'nod':
        return 'Page Turn: Nod';
      case 'tap':
        return 'Page Turn: Tap';
      case 'auto':
        return 'Page Turn: Auto';
      default:
        return 'Page Turn';
    }
  };

  const getMotionLabel = (motionType) => {
    switch (motionType) {
      case 'nod':
        return 'Nod';
      case 'turn_left':
        return 'Turn Left';
      case 'turn_right':
        return 'Turn Right';
      case 'tilt_left':
        return 'Tilt Left';
      case 'tilt_right':
        return 'Tilt Right';
      case 'open_mouth':
        return 'Open Mouth';
      default:
        return 'Manual';
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
    <SafeAreaView
      style={styles.container}
      onStartShouldSetResponder={() => {
        let shouldCapture = false;
        if (selectedPresenceUser) {
          setSelectedPresenceUser(null);
          shouldCapture = true;
        }
        if (showUserVisibilityDropdown) {
          setShowUserVisibilityDropdown(false);
          shouldCapture = true;
        }
        if (showPageTurnMenu) {
          setShowPageTurnMenu(false);
          shouldCapture = true;
        }
        if (showBackwardMenu) {
          setShowBackwardMenu(false);
          shouldCapture = true;
        }
        if (showForwardMenu) {
          setShowForwardMenu(false);
          shouldCapture = true;
        }
        return shouldCapture;
      }}
    >
      {Platform.OS === 'web' ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={
            config.nodDetection.showCameraPreview && nodEnabled && cameraEnabled
              ? styles.cameraPreview
              : styles.hiddenCameraVideo
          }
        />
      ) : null}

      {Platform.OS === 'web' && playbackUrl ? (
        <audio
          ref={webAudioRef}
          key={playbackUrl}
          preload="metadata"
          src={playbackUrl}
          onPlay={() => {
            setIsPlaying(true);
            startPlaybackHighlightSync();
          }}
          onPause={() => {
            setIsPlaying(false);
            stopPlaybackHighlightSync();
          }}
          onEnded={() => {
            setIsPlaying(false);
            stopPlaybackHighlightSync();
          }}
          onSeeked={(event) => {
            updateMeasureFromTime(event.currentTarget.currentTime);
          }}
          onTimeUpdate={(event) => updateMeasureFromTime(event.currentTarget.currentTime)}
          onError={() => {
            setAudioError('Unable to load the generated audio file.');
            setIsPlaying(false);
            stopPlaybackHighlightSync();
          }}
          style={{ display: 'none' }}
        />
      ) : null}

      <View style={styles.compactHeader}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <FontAwesomeIcon icon={faArrowLeft} size={20} color={COLORS.beige} />
        </TouchableOpacity>
        <View style={styles.titleSection}>
          <Text style={styles.compactTitle} numberOfLines={1}>
            {title}
          </Text>
          <TouchableOpacity onPress={handleRename} style={styles.editButtonNoBg}>
            <FontAwesomeIcon icon={faEdit} size={16} color={COLORS.beige} />
          </TouchableOpacity>
        </View>
        <View style={styles.headerActions}>
          {presentUsers.length > 0 && (
            <View style={styles.presenceContainer}>
              {presentUsers.map((user) => (
                <View key={user.user_id} style={styles.presenceWrapper}>
                  <TouchableOpacity
                    style={styles.presenceAvatar}
                    onPress={() =>
                      setSelectedPresenceUser(
                        selectedPresenceUser === user.user_id ? null : user.user_id
                      )
                    }
                  >
                    <Text style={styles.presenceAvatarText}>
                      {user.username?.charAt(0).toUpperCase() || '?'}
                    </Text>
                  </TouchableOpacity>
                  {selectedPresenceUser === user.user_id && (
                    <View style={styles.presenceTooltip}>
                      <Text style={styles.presenceTooltipText}>{user.username}</Text>
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}
          {shareCode && (
            <View style={styles.shareCodeContainer}>
              <Text style={styles.shareCodeLabel}>Share Code:</Text>
              <Text style={styles.shareCodeText}>{shareCode}</Text>
              <TouchableOpacity style={styles.copyButton} onPress={copyShareCode}>
                <FontAwesomeIcon icon={faCopy} size={14} color={COLORS.darkBrown} />
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      <View style={styles.headerSeparator} />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.toolbarScrollView}
        contentContainerStyle={styles.toolbarScrollContent}
      >
        <View style={styles.toolbarRow}>
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

          {/* Backward Motion */}
          <View style={styles.motionMenuWrapper}>
            <TouchableOpacity
              style={styles.motionButton}
              onPress={() => setShowBackwardMenu((prev) => !prev)}
            >
              <FontAwesomeIcon icon={faChevronLeft} size={14} color={COLORS.darkBrown} />
              <Text style={styles.motionButtonText}>{getMotionLabel(backwardMotion)}</Text>
              <FontAwesomeIcon icon={faChevronDown} size={10} color={COLORS.darkBrown} />
            </TouchableOpacity>

            {showBackwardMenu && (
              <View style={styles.motionDropdown}>
                <TouchableOpacity
                  style={styles.motionDropdownItem}
                  onPress={() => {
                    setBackwardMotion('manual');
                    setShowBackwardMenu(false);
                  }}
                >
                  <Text style={styles.motionDropdownText}>Manual</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.motionDropdownItem}
                  onPress={() => {
                    setBackwardMotion('nod');
                    setShowBackwardMenu(false);
                  }}
                >
                  <Text style={styles.motionDropdownText}>Nod</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.motionDropdownItem}
                  onPress={() => {
                    setBackwardMotion('turn_left');
                    setShowBackwardMenu(false);
                  }}
                >
                  <Text style={styles.motionDropdownText}>Turn Left</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.motionDropdownItem}
                  onPress={() => {
                    setBackwardMotion('turn_right');
                    setShowBackwardMenu(false);
                  }}
                >
                  <Text style={styles.motionDropdownText}>Turn Right</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.motionDropdownItem}
                  onPress={() => {
                    setBackwardMotion('tilt_left');
                    setShowBackwardMenu(false);
                  }}
                >
                  <Text style={styles.motionDropdownText}>Tilt Left</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.motionDropdownItem}
                  onPress={() => {
                    setBackwardMotion('tilt_right');
                    setShowBackwardMenu(false);
                  }}
                >
                  <Text style={styles.motionDropdownText}>Tilt Right</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.motionDropdownItem}
                  onPress={() => {
                    setBackwardMotion('open_mouth');
                    setShowBackwardMenu(false);
                  }}
                >
                  <Text style={styles.motionDropdownText}>Open Mouth</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Forward Motion */}
          <View style={styles.motionMenuWrapper}>
            <TouchableOpacity
              style={styles.motionButton}
              onPress={() => setShowForwardMenu((prev) => !prev)}
            >
              <FontAwesomeIcon icon={faChevronRight} size={14} color={COLORS.darkBrown} />
              <Text style={styles.motionButtonText}>{getMotionLabel(forwardMotion)}</Text>
              <FontAwesomeIcon icon={faChevronDown} size={10} color={COLORS.darkBrown} />
            </TouchableOpacity>

            {showForwardMenu && (
              <View style={styles.motionDropdown}>
                <TouchableOpacity
                  style={styles.motionDropdownItem}
                  onPress={() => {
                    setForwardMotion('manual');
                    setShowForwardMenu(false);
                  }}
                >
                  <Text style={styles.motionDropdownText}>Manual</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.motionDropdownItem}
                  onPress={() => {
                    setForwardMotion('nod');
                    setShowForwardMenu(false);
                  }}
                >
                  <Text style={styles.motionDropdownText}>Nod</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.motionDropdownItem}
                  onPress={() => {
                    setForwardMotion('turn_left');
                    setShowForwardMenu(false);
                  }}
                >
                  <Text style={styles.motionDropdownText}>Turn Left</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.motionDropdownItem}
                  onPress={() => {
                    setForwardMotion('turn_right');
                    setShowForwardMenu(false);
                  }}
                >
                  <Text style={styles.motionDropdownText}>Turn Right</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.motionDropdownItem}
                  onPress={() => {
                    setForwardMotion('tilt_left');
                    setShowForwardMenu(false);
                  }}
                >
                  <Text style={styles.motionDropdownText}>Tilt Left</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.motionDropdownItem}
                  onPress={() => {
                    setForwardMotion('tilt_right');
                    setShowForwardMenu(false);
                  }}
                >
                  <Text style={styles.motionDropdownText}>Tilt Right</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.motionDropdownItem}
                  onPress={() => {
                    setForwardMotion('open_mouth');
                    setShowForwardMenu(false);
                  }}
                >
                  <Text style={styles.motionDropdownText}>Open Mouth</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

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
            annotations={annotations}
            currentUserId={userId}
            currentUsername={username}
            presentUsers={presentUsers}
            hiddenAnnotationUsers={hiddenAnnotationUsers}
            showUserVisibilityDropdown={showUserVisibilityDropdown}
            onToggleDropdown={setShowUserVisibilityDropdown}
            onToggleUserVisibility={(toggledUserId) => {
              setHiddenAnnotationUsers((prev) => {
                const next = new Set(prev);
                if (next.has(toggledUserId)) {
                  next.delete(toggledUserId);
                } else {
                  next.add(toggledUserId);
                }
                return next;
              });
            }}
          />
        </View>
      </ScrollView>

      {(audioError ||
        cameraError ||
        (nodEnabled && !cameraEnabled) ||
        (nodEnabled && config.nodDetection.showDebug && debugInfo)) ? (
        <View style={styles.cameraStatusRow}>
          {audioError ? <Text style={styles.cameraStatusText}>{audioError}</Text> : null}
          {cameraError || (nodEnabled && !cameraEnabled) ? (
            <Text style={styles.cameraStatusText}>
              {cameraError || 'Starting front camera for nod detection...'}
            </Text>
          ) : null}
          {nodEnabled && cameraEnabled && config.nodDetection.showDebug && debugInfo ? (
            <Text style={[styles.cameraStatusText, styles.debugText]}>{debugInfo}</Text>
          ) : null}
        </View>
      ) : null}

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
          const containerWidth = width - pageHorizontalPadding * 2;
          const containerHeight = availablePageHeight;
          const isSvgPage = String(item.image_path || item.uri || '')
            .toLowerCase()
            .includes('.svg');

          const imageWidth = item.width || 1240;
          const imageHeight = item.height || 1754;

          const scale = Math.min(containerWidth / imageWidth, containerHeight / imageHeight);
          const displayedWidth = imageWidth * scale;
          const displayedHeight = imageHeight * scale;
          const imageOffsetX = (containerWidth - displayedWidth) / 2;
          const imageOffsetY = (containerHeight - displayedHeight) / 2;

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
                    padding: 0,
                  },
                ]}
              >
                {(() => {
                  const activeMeasureRegion =
                    activeMeasureIndex !== null
                      ? (item.measure_regions || []).find((region) => {
                          const regionIndex = Number(region.measure_index);
                          if (Number.isFinite(regionIndex)) {
                            return regionIndex === Number(activeMeasureIndex);
                          }
                          return Number(region.measure) === Number(activeMeasure);
                        })
                      : null;

                  const range = measurePageRanges[item.page_number - 1];
                  const isActiveRange =
                    !activeMeasureRegion &&
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
                  const overlayInset = 2;
                  const regionLeft = activeMeasureRegion
                    ? imageOffsetX + activeMeasureRegion.x * displayedWidth
                    : 0;
                  const regionTop = activeMeasureRegion
                    ? imageOffsetY + activeMeasureRegion.y * displayedHeight
                    : 0;
                  const regionRight = activeMeasureRegion
                    ? imageOffsetX + (activeMeasureRegion.x + activeMeasureRegion.width) * displayedWidth
                    : 0;
                  const regionBottom = activeMeasureRegion
                    ? imageOffsetY + (activeMeasureRegion.y + activeMeasureRegion.height) * displayedHeight
                    : 0;
                  const overlayLeft = activeMeasureRegion
                    ? Math.max(imageOffsetX, regionLeft - overlayInset)
                    : 0;
                  const overlayTop = activeMeasureRegion
                    ? Math.max(imageOffsetY, regionTop - overlayInset)
                    : 0;
                  const overlayRight = activeMeasureRegion
                    ? Math.min(imageOffsetX + displayedWidth, regionRight + overlayInset)
                    : 0;
                  const overlayBottom = activeMeasureRegion
                    ? Math.min(imageOffsetY + displayedHeight, regionBottom + overlayInset)
                    : 0;

                  return (
                    <>
                      <View style={styles.imageContainer}>
                        {isSvgPage && item.svgXml ? (
                          <SvgXml
                            xml={injectHighlightIntoSvg(item.svgXml, activeMeasureRegion)}
                            width={displayedWidth}
                            height={displayedHeight}
                            style={styles.pageSvg}
                          />
                        ) : isSvgPage ? (
                          <SvgUri
                            uri={item.uri}
                            width={displayedWidth}
                            height={displayedHeight}
                            style={styles.pageSvg}
                          />
                        ) : (
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
                        )}

                        {!isSvgPage && activeMeasureRegion ? (
                          <View
                            pointerEvents="none"
                            style={[
                              styles.measureOverlay,
                              {
                                left: overlayLeft,
                                top: overlayTop,
                                width: Math.max(18, overlayRight - overlayLeft),
                                height: Math.max(18, overlayBottom - overlayTop),
                              },
                            ]}
                          />
                        ) : null}

                        {isActiveRange ? (
                          <View
                            pointerEvents="none"
                            style={[
                              styles.measureOverlay,
                              {
                                left: imageOffsetX,
                                top: `${Math.min(88, bandTopPercent)}%`,
                                height: `${Math.min(28, bandHeightPercent)}%`,
                                width: displayedWidth,
                              },
                            ]}
                          />
                        ) : null}

                        {!annotationsEnabled ? (
                          <View pointerEvents="box-none" style={styles.measureHitAreaLayer}>
                            {(item.measure_regions || []).map((region, regionIndex) => {
                              const hitLeft = imageOffsetX + region.x * displayedWidth;
                              const hitTop = imageOffsetY + region.y * displayedHeight;
                              const hitWidth = region.width * displayedWidth;
                              const hitHeight = region.height * displayedHeight;

                              if (hitWidth <= 0 || hitHeight <= 0) {
                                return null;
                              }

                              return (
                                <TouchableOpacity
                                  key={`${item.page_number}-${region.measure_index ?? regionIndex}`}
                                  activeOpacity={1}
                                  style={[
                                    styles.measureHitArea,
                                    {
                                      left: hitLeft,
                                      top: hitTop,
                                      width: hitWidth,
                                      height: hitHeight,
                                    },
                                  ]}
                                  onPress={() => seekToMeasureRegion(region, item.page_number - 1)}
                                />
                              );
                            })}
                          </View>
                        ) : null}

                        {pageTurnMode === 'tap' && !annotationsEnabled ? (
                          <View pointerEvents="box-none" style={styles.tapTurnOverlay}>
                            <Pressable
                              style={[styles.tapTurnZone, styles.tapTurnZoneLeft]}
                              onPress={() => goToPage(currentPageRef.current - 1)}
                              disabled={currentPageRef.current === 0}
                            />
                            <Pressable
                              style={[styles.tapTurnZone, styles.tapTurnZoneRight]}
                              onPress={() => goToPage(currentPageRef.current + 1)}
                              disabled={currentPageRef.current >= pages.length - 1}
                            />
                          </View>
                        ) : null}

                        <AnnotationLayer
                          pageNumber={item.page_number}
                          width={containerWidth}
                          height={containerHeight}
                          imageWidth={displayedWidth}
                          imageHeight={displayedHeight}
                          imageOffsetX={imageOffsetX}
                          imageOffsetY={imageOffsetY}
                          annotations={annotations}
                          currentTool={currentTool}
                          currentColor={currentColor}
                          currentStrokeWidth={currentStrokeWidth}
                          onAnnotationCreated={handleAnnotationCreated}
                          onAnnotationUpdated={handleAnnotationUpdated}
                          enabled={annotationsEnabled && currentPage === item.page_number - 1}
                          currentUserId={userId}
                          presentUsers={presentUsers}
                          hiddenAnnotationUsers={hiddenAnnotationUsers}
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
          <FontAwesomeIcon icon={faBackward} size={20} color={COLORS.darkBrown} />
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
          <FontAwesomeIcon icon={faForward} size={20} color={COLORS.darkBrown} />
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
    backgroundColor: COLORS.lightBrown,
    paddingHorizontal: 16,
    paddingVertical: 24,
    height: 72,
    gap: 12,
    overflow: 'visible',
    zIndex: 10000,
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
    gap: 12,
    flexShrink: 1,
  },
  compactTitle: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 18,
    color: COLORS.beige,
    flexShrink: 1,
  },
  editButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.beige,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editButtonNoBg: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 'auto',
    overflow: 'visible',
  },
  headerSeparator: {
    height: 1,
    backgroundColor: COLORS.darkBrown,
    opacity: 0.15,
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
  shareCodeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.beige,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
  },
  shareCodeLabel: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 14,
    color: COLORS.lightBrown,
  },
  shareCodeText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.darkBrown,
    letterSpacing: 0.5,
  },
  copyButton: {
    padding: 4,
  },
  presenceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    overflow: 'visible',
  },
  presenceWrapper: {
    position: 'relative',
    zIndex: 1000,
  },
  presenceAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.darkBrown,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.beige,
  },
  presenceAvatarText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.beige,
  },
  presenceTooltip: {
    position: 'absolute',
    top: 38,
    left: '50%',
    transform: [{ translateX: '-50%' }],
    backgroundColor: COLORS.darkBrown,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    zIndex: 999999,
    alignItems: 'center',
    elevation: 999,
  },
  presenceTooltipText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 13,
    color: COLORS.beige,
  },
  hiddenCameraVideo: {
    position: 'absolute',
    top: -1000,
    left: -1000,
    width: 1,
    height: 1,
    opacity: 0,
    pointerEvents: 'none',
  },
  cameraPreview: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 160,
    height: 120,
    borderRadius: 12,
    zIndex: 1000,
    transform: [{ scaleX: -1 }],
    borderWidth: 3,
    borderColor: COLORS.darkBrown,
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
    overflow: 'visible',
  },
  pageCard: {
    position: 'relative',
    flex: 1,
    backgroundColor: '#FFFDF8',
    borderRadius: 16,
    overflow: 'visible',
    borderWidth: 1,
    borderColor: '#E2D6C8',
    justifyContent: 'flex-start',
    alignItems: 'center',
    padding: 14,
  },
  measureOverlay: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 214, 10, 0.18)',
    borderColor: 'rgba(196, 148, 0, 0.45)',
    borderWidth: 2,
    borderRadius: 0,
    zIndex: 2,
  },
  pageImage: {
    position: 'relative',
  },
  pageSvg: {
    position: 'relative',
  },
  imageContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    width: '100%',
    flex: 1,
    overflow: 'visible',
  },
  measureHitAreaLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 3,
  },
  measureHitArea: {
    position: 'absolute',
    backgroundColor: 'transparent',
  },
  tapTurnOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 4,
    flexDirection: 'row',
  },
  tapTurnZone: {
    height: '100%',
  },
  tapTurnZoneLeft: {
    width: '22%',
  },
  tapTurnZoneRight: {
    width: '22%',
    marginLeft: 'auto',
  },
  controlsContainer: {
    backgroundColor: COLORS.lightBrown,
    paddingHorizontal: 24,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  controlButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.beige,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlButtonTablet: {
    width: 50,
    height: 50,
    borderRadius: 25,
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
    fontSize: 16,
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
  toolbarScrollView: {
    backgroundColor: COLORS.lightBrown,
    maxHeight: 70,
  },
  toolbarScrollContent: {
    paddingHorizontal: 20,
  },
  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
    zIndex: 100,
    overflow: 'visible',
  },
  cameraStatusRow: {
    paddingHorizontal: 20,
    marginTop: -4,
    marginBottom: 10,
  },
  cameraStatusText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 14,
    color: COLORS.darkBrown,
  },
  debugText: {
    fontFamily: Platform.OS === 'web' ? 'monospace' : 'Courier',
    fontSize: 12,
    marginTop: 4,
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
  rightButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pageTurnMenuWrapper: {
    position: 'relative',
  },
  pageTurnChevron: {
    marginLeft: 8,
  },
  pageTurnDropdown: {
    position: 'absolute',
    top: 46,
    right: 0,
    backgroundColor: COLORS.beige,
    borderRadius: 12,
    paddingVertical: 6,
    minWidth: 190,
    borderWidth: 1,
    borderColor: '#E2D6C8',
    zIndex: 20000,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  pageTurnDropdownItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  pageTurnDropdownText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 16,
    color: COLORS.darkBrown,
  },
  motionMenuWrapper: {
    position: 'relative',
  },
  motionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.beige,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  motionButtonText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 14,
    color: COLORS.darkBrown,
  },
  motionDropdown: {
    position: 'absolute',
    top: 42,
    left: 0,
    backgroundColor: COLORS.beige,
    borderRadius: 8,
    paddingVertical: 6,
    minWidth: 160,
    borderWidth: 1,
    borderColor: '#E2D6C8',
    zIndex: 20000,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 8,
  },
  motionDropdownItem: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  motionDropdownText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 14,
    color: COLORS.darkBrown,
  },
});