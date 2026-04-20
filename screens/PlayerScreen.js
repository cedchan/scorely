import { useEffect, useMemo, useRef, useState } from 'react';
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
import { SvgUri, SvgXml } from 'react-native-svg';
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
  faCopy,
} from '@fortawesome/free-solid-svg-icons';
import AnnotationLayer from '../components/AnnotationLayer';
import AnnotationToolbar from '../components/AnnotationToolbar';
import annotationSyncService from '../services/annotationSync';
import { getApiBaseUrl } from '../services/apiBaseUrl';
import { initializeUserIdentity } from '../services/userIdentity';
import {
  FilesetResolver,
  FaceLandmarker
} from '@mediapipe/tasks-vision';
import { config } from '../config';

const COLORS = {
  beige: '#FAF7F0',
  lightBrown: '#A9988F',
  darkBrown: '#58392F',
};

const MEDIAPIPE_VERSION = '0.10.34';
// Small perceptual lead so the visual highlight lands with the heard note onset.
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
  // Nod state
  const [nodEnabled, setNodEnabled] = useState(false);
  // Annotation state
  const [annotations, setAnnotations] = useState([]);
  const [annotationsEnabled, setAnnotationsEnabled] = useState(false);
  const [currentTool, setCurrentTool] = useState('pen');
  const [currentColor, setCurrentColor] = useState('#D94848');
  const [currentStrokeWidth, setCurrentStrokeWidth] = useState(4);
  const [userId, setUserId] = useState('');
  const [username, setUsername] = useState('');
  const [shareCode, setShareCode] = useState(null);
  const [presentUsers, setPresentUsers] = useState([
    // Uncomment below to test presence UI:
    // { user_id: 'test1', username: 'SwiftEagle42' },
    // { user_id: 'test2', username: 'BraveTiger99' },
  ]);
  const [selectedPresenceUser, setSelectedPresenceUser] = useState(null);
  const [presenceTooltipPosition, setPresenceTooltipPosition] = useState({ x: 0, index: 0 });
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
  const pageManifestPath = route.params?.pageManifestPath || (jobId ? `/api/score-pages/${jobId}` : null);
  const cacheToken = jobId || route.params?.fileName || 'score';
  const isTabletLayout = width >= 900;
  const pageHorizontalPadding = isTabletLayout ? 56 : 20;
  const pageVerticalPadding = isTabletLayout ? 24 : 16;
  const pageTopPadding = isTabletLayout ? 32 : 24;
  const controlsHeight = isTabletLayout ? 108 : 94;
  const compactHeaderHeight = 56; // Header height
  const toolbarHeight = 58; // Annotation toolbar height (padding 10*2 + content ~38)
  const availablePageHeight = Math.max(
    320,
    height - compactHeaderHeight - toolbarHeight - controlsHeight - pageVerticalPadding - pageTopPadding
  );
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

  let [fontsLoaded] = useFonts({
    Afacad_400Regular,
  });

  // Initialize user identity
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
            const pageUri = `${apiBaseUrl}${page.image_path}?job=${encodeURIComponent(cacheToken)}&page=${page.page_number}`;
            const isSvgPage = String(page.image_path || '').toLowerCase().includes('.svg');
            let svgXml = null;

            if (isSvgPage) {
              try {
                const svgResponse = await fetch(pageUri);
                if (svgResponse.ok) {
                  svgXml = await svgResponse.text();
                }
              } catch (svgLoadError) {
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

        setAlignmentMappings(
          (data.mappings || []).map((mapping, index) => {
            const parsedIndex = Number(mapping.measure_index);
            return {
              ...mapping,
              measure_index: Number.isFinite(parsedIndex) ? parsedIndex : index,
            };
          })
        );
      } catch (loadError) {
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

  // Annotation WebSocket connection
  useEffect(() => {
    if (!jobId || !userId || !username) return;

    // Connect to annotation sync
    annotationSyncService.connect(apiBaseUrl, jobId, userId, username);

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

    const handlePresenceUpdate = ({ users }) => {
      console.log('Presence update received:', users);
      // Filter out current user
      const otherUsers = users.filter(u => u.user_id !== userId);
      console.log('Other users present:', otherUsers);
      setPresentUsers(otherUsers);
    };

    const handleUserJoined = ({ userId: joinedUserId, username: joinedUsername }) => {
      console.log('User joined:', joinedUserId, joinedUsername);
      if (joinedUserId !== userId) {
        setPresentUsers((prev) => {
          if (prev.some(u => u.user_id === joinedUserId)) {
            return prev;
          }
          return [...prev, { user_id: joinedUserId, username: joinedUsername }];
        });
      }
    };

    const handleUserLeft = ({ userId: leftUserId }) => {
      console.log('User left:', leftUserId);
      setPresentUsers((prev) => prev.filter(u => u.user_id !== leftUserId));
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

    // Cleanup
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
      if (
        typeof window !== 'undefined' &&
        !window.isSecureContext
      ) {
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
      console.log('startCameraAndTracking called', {
        platform: Platform.OS,
        isWeb: Platform.OS === 'web',
        hasNavigator: typeof navigator !== 'undefined',
        hasMediaDevices: typeof navigator !== 'undefined' && !!navigator.mediaDevices,
        hasGetUserMedia: typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia,
        isSecureContext: typeof window !== 'undefined' ? window.isSecureContext : 'N/A',
      });

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

      console.log('about to request camera');
      try {
        const stream = await requestCameraStream();
        console.log('camera stream obtained', {
          streamId: stream.id,
          tracks: stream.getTracks().length,
          videoTracks: stream.getVideoTracks().length,
        });
        console.log('loading mediapipe vision tasks...');
        setDebugInfo('Loading AI model...');
        const vision = await FilesetResolver.forVisionTasks(
          `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`
        );
        console.log('vision tasks loaded, creating face landmarker...');
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
        console.log('face landmarker created successfully');
        setDebugInfo('Face detector ready!');

        faceLandmarkerRef.current = faceLandmarker;
  
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          faceLandmarker.close?.();
          return;
        }
  
        streamRef.current = stream;
  
        if (videoRef.current) {
          console.log('setting up video element...');
          videoRef.current.muted = true;
          videoRef.current.autoplay = true;
          videoRef.current.playsInline = true;
          videoRef.current.setAttribute('muted', 'true');
          videoRef.current.setAttribute('autoplay', 'true');
          videoRef.current.setAttribute('playsinline', 'true');
          videoRef.current.setAttribute('webkit-playsinline', 'true');
          videoRef.current.srcObject = stream;
          console.log('calling play on video element...');
          await videoRef.current.play();
          console.log('waiting for video to be ready...');
          await waitForVideoReady(videoRef.current);
          console.log('video is ready!', {
            width: videoRef.current.videoWidth,
            height: videoRef.current.videoHeight,
            readyState: videoRef.current.readyState,
          });
        }

        if (cancelled) return;

        setCameraEnabled(true);
        console.log('camera enabled, starting detection loop');
  
        let frameCount = 0;
        const detectFrame = () => {
          frameCount++;

          if (cancelled) {
            console.log('detectFrame: cancelled');
            return;
          }

          if (!videoRef.current) {
            console.log('detectFrame: no videoRef');
            animationFrameRef.current = requestAnimationFrame(detectFrame);
            return;
          }

          if (!faceLandmarkerRef.current) {
            console.log('detectFrame: no faceLandmarker');
            animationFrameRef.current = requestAnimationFrame(detectFrame);
            return;
          }

          if (videoRef.current.readyState < 2) {
            if (frameCount % 30 === 0) { // Log every 30 frames
              console.log('detectFrame: video not ready', videoRef.current.readyState);
            }
            animationFrameRef.current = requestAnimationFrame(detectFrame);
            return;
          }

          let results;
          try {
            results = faceLandmarkerRef.current.detectForVideo(
              videoRef.current,
              performance.now()
            );
          } catch (err) {
            console.error('Error in detectForVideo:', err);
            setDebugInfo(`Error: ${err.message}`);
            animationFrameRef.current = requestAnimationFrame(detectFrame);
            return;
          }

          if (frameCount % 30 === 0) { // Log every 30 frames (~1 second)
            console.log('detection results:', {
              hasFaceLandmarks: !!results.faceLandmarks,
              numFaces: results.faceLandmarks?.length || 0,
              frameCount,
            });
          }

          const face = results.faceLandmarks?.[0];
  
          if (face) {
            const nose = face[1];
            const leftEye = face[33];
            const rightEye = face[263];

            if (nose && leftEye && rightEye) {
              const eyeY = (leftEye.y + rightEye.y) / 2;
              const relativeY = nose.y - eyeY;
              const delta = baselineRelativeYRef.current !== null
                ? relativeY - baselineRelativeYRef.current
                : 0;

              console.log(
                'face detected',
                'noseY:', nose.y,
                'leftEyeY:', leftEye.y,
                'rightEyeY:', rightEye.y,
                'eyeY:', eyeY
              );

              // Update debug overlay
              setDebugInfo(`✓ Face detected\nPhase: ${nodPhaseRef.current}\nDelta: ${delta.toFixed(4)}\nBaseline: ${baselineRelativeYRef.current?.toFixed(4) || 'null'}`);

              handleNodDetection(nose.y, eyeY);
            } else {
              setDebugInfo('✓ Face detected (missing landmarks)');
            }
          } else {
            if (frameCount % 15 === 0) { // Update every 15 frames
              setDebugInfo('✗ No face detected\nCheck lighting & position');
            }
          }
  
          animationFrameRef.current = requestAnimationFrame(detectFrame);
        };
  
        detectFrame();
      } catch (err) {
        console.error('Camera / face tracking error:', err?.name, err?.message, err);
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
      baselineRelativeYRef.current * baselineSmoothing + relativeY * (1 - baselineSmoothing);
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

    const effectiveTimeSeconds = Math.max(
      0,
      timeSeconds + PLAYBACK_HIGHLIGHT_LEAD_SECONDS
    );

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
    if (exactMeasureRegion && exactMeasureRegion.pageIndex !== currentPageRef.current) {
      goToPage(exactMeasureRegion.pageIndex);
      return;
    }

    const nextPageIndex = measurePageRanges.findIndex(
      (range) => nextMeasure !== null && nextMeasure >= range.startMeasure && nextMeasure <= range.endMeasure
    );

    if (nextPageIndex !== -1 && nextPageIndex !== currentPageRef.current) {
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
    } catch (seekError) {
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

  // Load share code on mount
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
      } catch (error) {
        alert('Failed to copy to clipboard');
      }
    } else {
      // For native platforms, you'd use Clipboard from @react-native-clipboard/clipboard
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
      onStartShouldSetResponder={(event) => {
        // Check if the touch target is within the visibility dropdown
        const target = event.target;
        let isDropdownClick = false;

        // Walk up the DOM tree to check if we're inside the dropdown
        let currentElement = target;
        while (currentElement) {
          if (currentElement.className &&
              (String(currentElement.className).includes('visibilityDropdown') ||
               String(currentElement.className).includes('visibilityRow'))) {
            isDropdownClick = true;
            break;
          }
          currentElement = currentElement.parentElement;
        }

        let shouldCapture = false;
        if (selectedPresenceUser) {
          setSelectedPresenceUser(null);
          shouldCapture = true;
        }
        if (showUserVisibilityDropdown && !isDropdownClick) {
          setShowUserVisibilityDropdown(false);
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
          style={config.nodDetection.showCameraPreview && nodEnabled && cameraEnabled ? styles.cameraPreview : styles.hiddenCameraVideo}
        />
      ) : null}

      {/* Hidden audio element */}
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
          {presentUsers.length > 0 && (
            <View style={styles.presenceContainer}>
              {presentUsers.map((user, index) => (
                <TouchableOpacity
                  key={user.user_id}
                  style={styles.presenceAvatar}
                  onPress={(event) => {
                    if (selectedPresenceUser === user.user_id) {
                      setSelectedPresenceUser(null);
                    } else {
                      setSelectedPresenceUser(user.user_id);
                      // Calculate position based on avatar index
                      // Each avatar is 32px wide + 6px gap
                      const baseOffset = shareCode ? 280 : 20;
                      const avatarOffset = index * (32 + 6);
                      setPresenceTooltipPosition({ x: baseOffset + avatarOffset + 16, index });
                    }
                  }}
                >
                  <Text style={styles.presenceAvatarText}>
                    {user.username?.charAt(0).toUpperCase() || '?'}
                  </Text>
                </TouchableOpacity>
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

      {/* Presence Tooltip Overlay - rendered separately for proper z-index */}
      {selectedPresenceUser && (
        <View
          style={[
            styles.presenceTooltipOverlay,
            {
              right: width - presenceTooltipPosition.x,
              top: 72,
            }
          ]}
          pointerEvents="none"
        >
          <Text style={styles.presenceTooltipText}>
            {presentUsers.find(u => u.user_id === selectedPresenceUser)?.username}
          </Text>
        </View>
      )}

      {/* Annotation Toolbar */}
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

        <View style={styles.rightButtons}>
          <TouchableOpacity
            style={[styles.gestureButton, nodEnabled && styles.gestureButtonActive]}
            onPress={() => {
              console.log('nod button clicked');
              if (Platform.OS !== 'web') {
                setCameraError(
                  'Nod detection currently uses the web camera pipeline. Open the score in Safari over HTTPS on iPad to use the front camera.'
                );
                return;
              }

              setCameraError(null);
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

      {(cameraError || (nodEnabled && !cameraEnabled) || (nodEnabled && config.nodDetection.showDebug && debugInfo)) ? (
        <View style={styles.cameraStatusRow}>
          <Text style={styles.cameraStatusText}>
            {cameraError || (nodEnabled && !cameraEnabled ? 'Starting front camera for nod detection...' : '')}
          </Text>
          {nodEnabled && cameraEnabled && config.nodDetection.showDebug && debugInfo ? (
            <Text style={[styles.cameraStatusText, { fontFamily: 'Courier', fontSize: 12, marginTop: 4 }]}>
              {debugInfo}
            </Text>
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
          // Use full available space now that labels are removed
          const containerWidth = width - pageHorizontalPadding * 2;
          const containerHeight = availablePageHeight;
          const isSvgPage = String(item.image_path || item.uri || '').toLowerCase().includes('.svg');

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

                        {/* Annotation Layer */}
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
    backgroundColor: COLORS.lightBrown,
    paddingHorizontal: 16,
    paddingVertical: 24,
    height: 72,
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 'auto',
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
  presenceTooltipOverlay: {
    position: 'absolute',
    backgroundColor: COLORS.darkBrown,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    zIndex: 999999,
    minWidth: 80,
    alignItems: 'center',
    elevation: 999,
    transform: [{ translateX: -40 }],
  },
  presenceTooltipText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 13,
    color: COLORS.beige,
    whiteSpace: 'nowrap',
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
    border: '3px solid #58392F',
    zIndex: 1000,
    transform: 'scaleX(-1)', // Mirror the video
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
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
  },
  measureHitAreaLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 3,
  },
  measureHitArea: {
    position: 'absolute',
    backgroundColor: 'transparent',
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
    zIndex: 10000,
    position: 'relative',
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
  debugButton: {
    marginLeft: 8,
    backgroundColor: COLORS.beige,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },

  debugButtonActive: {
    backgroundColor: '#FFD60A',
  },

  debugButtonText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 14,
    color: COLORS.darkBrown,
  },

  debugButtonTextActive: {
    color: '#58392F',
    fontWeight: 'bold',
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
