import React, { useEffect, useRef, useState, useMemo } from 'react';
import { PanResponder, Platform, StyleSheet, View, Text } from 'react-native';
import Svg, { Path, Circle, Rect, Text as SvgText } from 'react-native-svg';
import { config } from '../config';

const COLORS = {
  beige: '#FAF7F0',
  lightBrown: '#A9988F',
  darkBrown: '#58392F',
};

function pointsToRawPathStringStatic(points, normalizeWidth, normalizeHeight, imageOffsetX, imageOffsetY) {
  if (!points || points.length === 0) return '';

  const px = points.map((p) => ({
    x: (p.x / 100) * normalizeWidth + imageOffsetX,
    y: (p.y / 100) * normalizeHeight + imageOffsetY,
  }));

  const first = px[0];
  let d = `M ${first.x} ${first.y}`;

  if (px.length === 1) {
    d += ` L ${first.x} ${first.y}`;
    return d;
  }

  if (px.length === 2) {
    d += ` L ${px[1].x} ${px[1].y}`;
    return d;
  }

  for (let i = 1; i < px.length; i += 1) {
    d += ` L ${px[i].x} ${px[i].y}`;
  }

  return d;
}

function pointsToCanvasPixels(points, normalizeWidth, normalizeHeight, imageOffsetX, imageOffsetY) {
  return (points || []).map((point) => ({
    x: (point.x / 100) * normalizeWidth + imageOffsetX,
    y: (point.y / 100) * normalizeHeight + imageOffsetY,
  }));
}

function tracePolylineOnCanvas(
  ctx,
  points,
  normalizeWidth,
  normalizeHeight,
  imageOffsetX,
  imageOffsetY,
  startIndex = 0
) {
  const px = pointsToCanvasPixels(points, normalizeWidth, normalizeHeight, imageOffsetX, imageOffsetY);
  if (!px.length) {
    return false;
  }

  if (px.length === 1) {
    ctx.beginPath();
    ctx.arc(px[0].x, px[0].y, Math.max(1, ctx.lineWidth / 2), 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.globalAlpha = 1;
    ctx.fill();
    return true;
  }

  const clampedStart = Math.max(0, Math.min(startIndex, px.length - 1));
  const moveIndex = clampedStart > 0 ? clampedStart - 1 : 0;

  ctx.beginPath();
  ctx.moveTo(px[moveIndex].x, px[moveIndex].y);

  for (let index = moveIndex + 1; index < px.length; index += 1) {
    ctx.lineTo(px[index].x, px[index].y);
  }

  return true;
}

export default function AnnotationLayer({
  pageNumber,
  width,
  height,
  imageWidth,
  imageHeight,
  imageOffsetX = 0,
  imageOffsetY = 0,
  annotations,
  currentTool,
  currentColor,
  currentStrokeWidth,
  onAnnotationCreated,
  onAnnotationUpdated,
  enabled = true,
  style,
  currentUserId = '',
  presentUsers = [],
  hiddenAnnotationUsers = new Set(),
}) {
  // Use image dimensions for coordinate normalization, container dimensions for drawing area
  const normalizeWidth = imageWidth || width;
  const normalizeHeight = imageHeight || height;
  const [currentPathPoints, setCurrentPathPoints] = useState([]);
  const [eraserPosition, setEraserPosition] = useState(null);
  const currentPathPointsRef = useRef([]);
  const eraserPositionRef = useRef(null);
  const annotationsToEraseRef = useRef([]);
  const tempAnnotationIdRef = useRef(null);
  const updateThrottleRef = useRef(null);
  const lastUpdateTimeRef = useRef(0);
  const pendingUpdateRef = useRef(null);
  const eraserRadius = 20;
  const strokeIdCounterRef = useRef(0);
  const tempSignaturesRef = useRef(new Map());
  const debugMetricsRef = useRef({
    inputMode: '',
    strokeActive: false,
    strokeStartedAt: 0,
    totalPoints: 0,
    pointerMoves: 0,
    coalescedEvents: 0,
    coalescedBatches: 0,
    maxGapMs: 0,
    lastGapMs: 0,
    firstFollowupGapMs: 0,
    earlyWindowPoints: 0,
    lastSampleAt: 0,
    sampleTimes: [],
    pointsPerSecond: 0,
  });
  const lastDebugFlushRef = useRef(0);
  const [debugOverlay, setDebugOverlay] = useState({
    inputMode: '',
    strokeActive: false,
    totalPoints: 0,
    pointerMoves: 0,
    coalescedEvents: 0,
    coalescedAvg: 0,
    maxGapMs: 0,
    lastGapMs: 0,
    firstFollowupGapMs: 0,
    earlyWindowPoints: 0,
    pointsPerSecond: 0,
  });

  // Refs that mirror props — keep panResponder stable (no mid-stroke recreations)
  const enabledRef = useRef(enabled);
  const currentToolRef = useRef(currentTool);
  const currentColorRef = useRef(currentColor);
  const currentStrokeWidthRef = useRef(currentStrokeWidth);
  const pageNumberRef = useRef(pageNumber);
  const currentUserIdRef = useRef(currentUserId);
  const onAnnotationUpdatedRef = useRef(onAnnotationUpdated);
  const annotationsRef = useRef(annotations);
  const normalizeWidthRef = useRef(normalizeWidth);
  const normalizeHeightRef = useRef(normalizeHeight);
  const imageOffsetXRef = useRef(imageOffsetX);
  const imageOffsetYRef = useRef(imageOffsetY);
  const containerRef = useRef(null);
  const activePointerIdRef = useRef(null);
  const activeTouchIdRef = useRef(null);

  // Sync all prop-refs every render (no extra effects, just assignments)
  enabledRef.current = enabled;
  currentToolRef.current = currentTool;
  currentColorRef.current = currentColor;
  currentStrokeWidthRef.current = currentStrokeWidth;
  pageNumberRef.current = pageNumber;
  currentUserIdRef.current = currentUserId;
  onAnnotationUpdatedRef.current = onAnnotationUpdated;
  annotationsRef.current = annotations;
  normalizeWidthRef.current = normalizeWidth;
  normalizeHeightRef.current = normalizeHeight;
  imageOffsetXRef.current = imageOffsetX;
  imageOffsetYRef.current = imageOffsetY;
  eraserPositionRef.current = eraserPosition;

  const buildNormalizedPoint = (locationX, locationY) => {
    const adjustedX = locationX - imageOffsetXRef.current;
    const adjustedY = locationY - imageOffsetYRef.current;
    const safeWidth = Math.max(1, normalizeWidthRef.current);
    const safeHeight = Math.max(1, normalizeHeightRef.current);

    return {
      // Keep score-relative coordinates, but allow values outside 0-100 so
      // annotations can extend into page whitespace around the rendered image.
      x: (adjustedX / safeWidth) * 100,
      y: (adjustedY / safeHeight) * 100,
    };
  };

  const flushDebugOverlay = (force = false) => {
    const now = Date.now();
    if (!force && now - lastDebugFlushRef.current < 80) {
      return;
    }
    lastDebugFlushRef.current = now;
    const metrics = debugMetricsRef.current;
    setDebugOverlay({
      inputMode: metrics.inputMode,
      strokeActive: metrics.strokeActive,
      totalPoints: metrics.totalPoints,
      pointerMoves: metrics.pointerMoves,
      coalescedEvents: metrics.coalescedEvents,
      coalescedAvg: metrics.coalescedBatches
        ? metrics.coalescedEvents / metrics.coalescedBatches
        : 0,
      maxGapMs: metrics.maxGapMs,
      lastGapMs: metrics.lastGapMs,
      firstFollowupGapMs: metrics.firstFollowupGapMs,
      earlyWindowPoints: metrics.earlyWindowPoints,
      pointsPerSecond: metrics.pointsPerSecond,
    });
  };

  const resetDebugMetrics = (inputMode = '') => {
    const now = Date.now();
    debugMetricsRef.current = {
      inputMode,
      strokeActive: true,
      strokeStartedAt: now,
      totalPoints: 0,
      pointerMoves: 0,
      coalescedEvents: 0,
      coalescedBatches: 0,
      maxGapMs: 0,
      lastGapMs: 0,
      firstFollowupGapMs: 0,
      earlyWindowPoints: 0,
      lastSampleAt: 0,
      sampleTimes: [],
      pointsPerSecond: 0,
    };
    flushDebugOverlay(true);
  };

  const recordDebugSamples = (sampleCount, pointerEventCount = 1, inputMode = '') => {
    const now = Date.now();
    const metrics = debugMetricsRef.current;
    const nextTotal = metrics.totalPoints + sampleCount;
    const nextPointerMoves = metrics.pointerMoves + pointerEventCount;
    const nextCoalescedEvents = metrics.coalescedEvents + sampleCount;
    const nextCoalescedBatches = metrics.coalescedBatches + pointerEventCount;
    const lastGapMs = metrics.lastSampleAt ? now - metrics.lastSampleAt : 0;
    const maxGapMs = Math.max(metrics.maxGapMs, lastGapMs);
    const sampleTimes = [...metrics.sampleTimes, ...Array(sampleCount).fill(now)].filter(
      (timestamp) => now - timestamp <= 1000
    );
    const earlyWindowPoints =
      now - metrics.strokeStartedAt <= 120
        ? metrics.earlyWindowPoints + sampleCount
        : metrics.earlyWindowPoints;

    debugMetricsRef.current = {
      ...metrics,
      inputMode: inputMode || metrics.inputMode,
      strokeActive: true,
      totalPoints: nextTotal,
      pointerMoves: nextPointerMoves,
      coalescedEvents: nextCoalescedEvents,
      coalescedBatches: nextCoalescedBatches,
      lastGapMs,
      lastSampleAt: now,
      maxGapMs,
      firstFollowupGapMs:
        metrics.totalPoints > 0 && metrics.firstFollowupGapMs === 0 ? lastGapMs : metrics.firstFollowupGapMs,
      earlyWindowPoints,
      sampleTimes,
      pointsPerSecond: sampleTimes.length,
    };
    flushDebugOverlay();
  };

  const finishDebugMetrics = () => {
    debugMetricsRef.current = {
      ...debugMetricsRef.current,
      strokeActive: false,
    };
    flushDebugOverlay(true);
  };

  const sendLiveUpdate = useRef((points) => {
    if (!onAnnotationUpdatedRef.current || !tempAnnotationIdRef.current) return;
    onAnnotationUpdatedRef.current({
      id: tempAnnotationIdRef.current,
      job_id: '',
      page_number: pageNumberRef.current,
      type: 'path',
      user_id: currentUserIdRef.current,
      timestamp: Date.now() / 1000,
      path: {
        points,
        color: currentColorRef.current,
        strokeWidth: currentStrokeWidthRef.current,
        opacity: 1.0,
      },
      _isTemp: true,
    });
  }).current;

  const sendThrottledLiveUpdate = useRef((points) => {
    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdateTimeRef.current;
    const UPDATE_INTERVAL = 16;

    pendingUpdateRef.current = points;

    if (timeSinceLastUpdate >= UPDATE_INTERVAL) {
      sendLiveUpdate(points);
      lastUpdateTimeRef.current = now;
      pendingUpdateRef.current = null;
    } else {
      if (!updateThrottleRef.current) {
        updateThrottleRef.current = setTimeout(() => {
          if (pendingUpdateRef.current) {
            sendLiveUpdate(pendingUpdateRef.current);
            lastUpdateTimeRef.current = Date.now();
            pendingUpdateRef.current = null;
          }
          updateThrottleRef.current = null;
        }, UPDATE_INTERVAL - timeSinceLastUpdate);
      }
    }
  }).current;

  const checkForAnnotationsToErase = useRef((x, y) => {
    const eraseRadius = 20;
    const pageAnnotations = annotationsRef.current.filter(
      (ann) => ann.page_number === pageNumberRef.current
    );

    pageAnnotations.forEach((annotation) => {
      // Skip if already marked for erasure
      if (annotationsToEraseRef.current.includes(annotation.id)) {
        return;
      }

      if (annotation.type === 'path' && annotation.path) {
        const nw = normalizeWidthRef.current;
        const nh = normalizeHeightRef.current;
        const ox = imageOffsetXRef.current;
        const oy = imageOffsetYRef.current;
        const pts = annotation.path.points.map((p) => ({
          x: (p.x / 100) * nw + ox,
          y: (p.y / 100) * nh + oy,
        }));

        const distToSegment = (px, py, ax, ay, bx, by) => {
          const dx = bx - ax; const dy = by - ay;
          const lenSq = dx * dx + dy * dy;
          if (lenSq === 0) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
          const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
          return Math.sqrt((px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2);
        };

        const touched = pts.some((pt, i) => {
          if (i === 0) return Math.sqrt((pt.x - x) ** 2 + (pt.y - y) ** 2) < eraseRadius;
          return distToSegment(x, y, pts[i - 1].x, pts[i - 1].y, pt.x, pt.y) < eraseRadius;
        });

        if (touched && onAnnotationUpdatedRef.current) {
          annotationsToEraseRef.current.push(annotation.id);
          onAnnotationUpdatedRef.current({ ...annotation, _deleted: true });
        }
      }
    });
  }).current;

  const finalizeCurrentStroke = useRef(() => {
    if (!enabledRef.current || currentToolRef.current !== 'pen' || currentPathPointsRef.current.length === 0) {
      return;
    }

    if (updateThrottleRef.current) {
      clearTimeout(updateThrottleRef.current);
      updateThrottleRef.current = null;
    }

    const finalPoints = currentPathPointsRef.current.slice();
    const frozenPathString = pointsToRawPathStringStatic(
      finalPoints,
      normalizeWidthRef.current,
      normalizeHeightRef.current,
      imageOffsetXRef.current,
      imageOffsetYRef.current
    );

    onAnnotationUpdatedRef.current?.({
      id: tempAnnotationIdRef.current,
      job_id: '',
      page_number: pageNumberRef.current,
      type: 'path',
      user_id: currentUserIdRef.current,
      timestamp: Date.now() / 1000,
      path: {
        points: finalPoints,
        color: currentColorRef.current,
        strokeWidth: currentStrokeWidthRef.current,
        opacity: 1.0,
        _frozenPathString: frozenPathString,
      },
      _isFinal: true,
    });

    currentPathPointsRef.current = [];
    if (isWebCanvas) {
      redrawLiveCanvas();
    } else {
      setCurrentPathPoints([]);
    }
    tempAnnotationIdRef.current = null;
    pendingUpdateRef.current = null;
  }).current;

  // panResponder is created once and never recreated — all values read via refs
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => enabledRef.current,
    onMoveShouldSetPanResponder: () => enabledRef.current,

    onPanResponderGrant: (event) => {
      const { locationX, locationY } = event.nativeEvent;
      startInteractionAt(locationX, locationY);
    },

    onPanResponderMove: (event) => {
      const { locationX, locationY } = event.nativeEvent;
      moveInteractionTo(locationX, locationY);
    },

    onPanResponderRelease: () => {
      endInteraction();
    },

    onPanResponderTerminate: () => {
      cancelInteraction();
    },
  }), []);  // Empty deps — stable forever, reads via refs

  // Catmull-Rom → cubic bezier, parameterized (used both inline and at freeze time)
  const pointsToCommittedPathString = (points) =>
    pointsToRawPathStringStatic(points, normalizeWidth, normalizeHeight, imageOffsetX, imageOffsetY);
  const pointsToLivePathString = (points) =>
    pointsToRawPathStringStatic(points, normalizeWidth, normalizeHeight, imageOffsetX, imageOffsetY);
  const staticCanvasRef = useRef(null);
  const liveCanvasRef = useRef(null);
  const isWebCanvas = Platform.OS === 'web';
  const pageAnnotations = annotations.filter((ann) => {
    if (ann.page_number !== pageNumber) return false;
    if (hiddenAnnotationUsers.has(ann.user_id)) return false;
    return true;
  });
  const pathAnnotations = useMemo(
    () => pageAnnotations.filter((annotation) => annotation.type === 'path' && annotation.path),
    [pageAnnotations]
  );
  const vectorAnnotations = useMemo(
    () => pageAnnotations.filter((annotation) => annotation.type !== 'path'),
    [pageAnnotations]
  );
  const canvasPathAnnotations = useMemo(
    () =>
      pathAnnotations.filter(
        (annotation) => !(annotation._isTemp === true && annotation.user_id === currentUserId)
      ),
    [currentUserId, pathAnnotations]
  );

  const configureCanvas = (canvas, options = {}) => {
    const { clear = true } = options;
    if (!canvas) {
      return null;
    }

    const dpr =
      typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    const desiredWidth = Math.max(1, Math.round(width * dpr));
    const desiredHeight = Math.max(1, Math.round(height * dpr));

    if (canvas.width !== desiredWidth || canvas.height !== desiredHeight) {
      canvas.width = desiredWidth;
      canvas.height = desiredHeight;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }

    const ctx = canvas.getContext('2d', { desynchronized: true });
    if (!ctx) {
      return null;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (clear) {
      ctx.clearRect(0, 0, width, height);
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    return ctx;
  };

  const clearLiveCanvas = () => {
    if (!isWebCanvas || !liveCanvasRef.current) {
      return;
    }
    configureCanvas(liveCanvasRef.current, { clear: true });
  };

  const drawLiveStrokeSegment = (points, startIndex = 0) => {
    if (!isWebCanvas || !liveCanvasRef.current || !points.length) {
      return;
    }

    const ctx = configureCanvas(liveCanvasRef.current, { clear: startIndex === 0 });
    if (!ctx) {
      return;
    }

    ctx.strokeStyle = currentColorRef.current;
    ctx.lineWidth = currentStrokeWidthRef.current;
    ctx.globalAlpha = 1;

    if (
      tracePolylineOnCanvas(
        ctx,
        points,
        normalizeWidthRef.current,
        normalizeHeightRef.current,
        imageOffsetXRef.current,
        imageOffsetYRef.current,
        startIndex
      )
    ) {
      ctx.stroke();
    }
  };

  const redrawLiveCanvas = () => {
    if (!isWebCanvas || !liveCanvasRef.current) {
      return;
    }

    const ctx = configureCanvas(liveCanvasRef.current, { clear: true });
    if (!ctx) {
      return;
    }

    if (currentToolRef.current === 'pen' && currentPathPointsRef.current.length > 0) {
      if (
        tracePolylineOnCanvas(
          ctx,
          currentPathPointsRef.current,
          normalizeWidthRef.current,
          normalizeHeightRef.current,
          imageOffsetXRef.current,
          imageOffsetYRef.current,
          0
        )
      ) {
        ctx.strokeStyle = currentColorRef.current;
        ctx.lineWidth = currentStrokeWidthRef.current;
        ctx.globalAlpha = 1;
        ctx.stroke();
      }
    }

    if (currentToolRef.current === 'eraser' && eraserPositionRef.current) {
      ctx.beginPath();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = COLORS.darkBrown;
      ctx.lineWidth = 2;
      ctx.arc(
        eraserPositionRef.current.x,
        eraserPositionRef.current.y,
        eraserRadius,
        0,
        Math.PI * 2
      );
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  };

  const setCurrentStrokePoints = (points) => {
    currentPathPointsRef.current = points;
    if (isWebCanvas) {
      drawLiveStrokeSegment(points, 0);
    } else {
      setCurrentPathPoints(points);
    }
  };

  const setCurrentEraserPosition = (position) => {
    eraserPositionRef.current = position;
    setEraserPosition(position);
    if (isWebCanvas) {
      redrawLiveCanvas();
    }
  };

  const clearCurrentStroke = () => {
    currentPathPointsRef.current = [];
    if (isWebCanvas) {
      clearLiveCanvas();
    } else {
      setCurrentPathPoints([]);
    }
  };

  const startInteractionAt = (locationX, locationY, inputMode = '') => {
    if (!enabledRef.current) {
      return;
    }

    if (currentToolRef.current === 'pen') {
      const initialPoints = [buildNormalizedPoint(locationX, locationY)];
      if (isWebCanvas) {
        resetDebugMetrics(inputMode);
        recordDebugSamples(initialPoints.length, 1, inputMode);
      }
      setCurrentStrokePoints(initialPoints);
      strokeIdCounterRef.current += 1;
      tempAnnotationIdRef.current = `temp-${Date.now()}-${strokeIdCounterRef.current}`;
      sendLiveUpdate(initialPoints);
      return;
    }

    if (currentToolRef.current === 'eraser') {
      annotationsToEraseRef.current = [];
      setCurrentEraserPosition({ x: locationX, y: locationY });
      checkForAnnotationsToErase(locationX, locationY);
    }
  };

  const moveInteractionPoints = (nextPoints, pointerEventCount = 1) => {
    if (!enabledRef.current) {
      return;
    }

    if (currentToolRef.current === 'pen') {
      if (!nextPoints.length) {
        return;
      }

      const appendedPoints = [];
      let lastPoint =
        currentPathPointsRef.current[currentPathPointsRef.current.length - 1] || null;

      nextPoints.forEach((point) => {
        if (lastPoint && lastPoint.x === point.x && lastPoint.y === point.y) {
          return;
        }
        appendedPoints.push(point);
        lastPoint = point;
      });

      if (!appendedPoints.length) {
        return;
      }

      if (isWebCanvas) {
        recordDebugSamples(appendedPoints.length, pointerEventCount);
      }

      const newPoints = [...currentPathPointsRef.current, ...appendedPoints];
      if (isWebCanvas) {
        const previousLength = currentPathPointsRef.current.length;
        currentPathPointsRef.current = newPoints;
        drawLiveStrokeSegment(newPoints, Math.max(0, previousLength - 1));
      } else {
        setCurrentStrokePoints(newPoints);
      }
      sendThrottledLiveUpdate(newPoints);
      return;
    }

    if (currentToolRef.current === 'eraser') {
      const lastPoint = nextPoints[nextPoints.length - 1];
      if (!lastPoint) {
        return;
      }
      const safeWidth = Math.max(1, normalizeWidthRef.current);
      const safeHeight = Math.max(1, normalizeHeightRef.current);
      const locationX = (lastPoint.x / 100) * safeWidth + imageOffsetXRef.current;
      const locationY = (lastPoint.y / 100) * safeHeight + imageOffsetYRef.current;
      setCurrentEraserPosition({ x: locationX, y: locationY });
      checkForAnnotationsToErase(locationX, locationY);
    }
  };

  const moveInteractionTo = (locationX, locationY) => {
    moveInteractionPoints([buildNormalizedPoint(locationX, locationY)]);
  };

  const endInteraction = () => {
    if (!enabledRef.current) {
      return;
    }

    if (currentToolRef.current === 'pen') {
      finalizeCurrentStroke();
      if (isWebCanvas) {
        finishDebugMetrics();
      }
      return;
    }

    if (currentToolRef.current === 'eraser') {
      annotationsToEraseRef.current = [];
      setCurrentEraserPosition(null);
    }
  };

  const cancelInteraction = () => {
    if (currentToolRef.current === 'pen') {
      finalizeCurrentStroke();
      if (isWebCanvas) {
        finishDebugMetrics();
      }
    } else {
      clearCurrentStroke();
    }
    annotationsToEraseRef.current = [];
    setCurrentEraserPosition(null);
  };

  useEffect(() => () => {
    if (updateThrottleRef.current) {
      clearTimeout(updateThrottleRef.current);
    }
    lingerTimersRef.current.forEach((timer) => clearTimeout(timer));
  }, []);

  useEffect(() => {
    if (!isWebCanvas || !staticCanvasRef.current) {
      return undefined;
    }

    const ctx = configureCanvas(staticCanvasRef.current);
    if (!ctx) {
      return undefined;
    }

    canvasPathAnnotations.forEach((annotation) => {
      if (!annotation.path) {
        return;
      }

      if (
        !tracePolylineOnCanvas(
          ctx,
          annotation.path.points,
          normalizeWidth,
          normalizeHeight,
          imageOffsetX,
          imageOffsetY,
          0
        )
      ) {
        return;
      }

      ctx.strokeStyle = annotation.path.color;
      ctx.lineWidth = annotation.path.strokeWidth;
      ctx.globalAlpha = annotation.path.opacity ?? 1;
      ctx.stroke();
    });

    vectorAnnotations.forEach((annotation) => {
      if (annotation.type === 'text' && annotation.text) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = annotation.text.color;
        ctx.font = `${annotation.text.fontSize}px Afacad_400Regular, sans-serif`;
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(
          annotation.text.content,
          (annotation.text.position.x / 100) * normalizeWidth + imageOffsetX,
          (annotation.text.position.y / 100) * normalizeHeight + imageOffsetY
        );
        return;
      }

      if (annotation.type === 'shape' && annotation.shape) {
        const { shapeType, bounds, color, strokeWidth } = annotation.shape;
        const x = (bounds.x / 100) * normalizeWidth + imageOffsetX;
        const y = (bounds.y / 100) * normalizeHeight + imageOffsetY;
        const w = (bounds.width / 100) * normalizeWidth;
        const h = (bounds.height / 100) * normalizeHeight;

        ctx.beginPath();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = color;
        ctx.lineWidth = strokeWidth;

        if (shapeType === 'circle') {
          ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2);
          ctx.stroke();
          return;
        }

        if (shapeType === 'rect') {
          ctx.strokeRect(x, y, w, h);
        }
      }
    });

    ctx.globalAlpha = 1;
    return undefined;
  }, [
    canvasPathAnnotations,
    height,
    imageOffsetX,
    imageOffsetY,
    isWebCanvas,
    normalizeHeight,
    normalizeWidth,
    vectorAnnotations,
    width,
  ]);

  useEffect(() => {
    if (!isWebCanvas) {
      return undefined;
    }

    redrawLiveCanvas();
    return undefined;
  }, [eraserPosition, height, isWebCanvas, width]);

  useEffect(() => {
    if (!isWebCanvas || !containerRef.current) {
      return undefined;
    }

    const element = containerRef.current;
    element.style.touchAction = 'none';
    element.style.webkitUserSelect = 'none';
    element.style.userSelect = 'none';
    element.style.webkitTouchCallout = 'none';
    element.style.webkitTapHighlightColor = 'transparent';
    element.style.caretColor = 'transparent';

    const getRelativePoint = (event) => {
      const rect = element.getBoundingClientRect();
      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
    };

    const preventNativeUi = (event) => {
      event.preventDefault();
    };

    // Prefer pointer events over touch events: pointer events support getCoalescedEvents(),
    // which delivers sub-frame Apple Pencil samples (~120 Hz on iPad Pro). Touch events
    // only fire once per display frame (~60 Hz) and have no coalescing API.
    const supportsPointer = typeof window !== 'undefined' && typeof window.PointerEvent !== 'undefined';
    const defaultInputMode = supportsPointer ? 'pointer' : 'touch';
    if (!debugMetricsRef.current.strokeActive) {
      debugMetricsRef.current = {
        ...debugMetricsRef.current,
        inputMode: defaultInputMode,
      };
      flushDebugOverlay(true);
    }

    const touchOptions = { passive: false };

    const handleTouchStart = (event) => {
      if (!enabledRef.current || activeTouchIdRef.current !== null) {
        return;
      }

      const touch = event.changedTouches?.[0];
      if (!touch) {
        return;
      }

      activeTouchIdRef.current = touch.identifier;
      event.preventDefault();

      const point = getRelativePoint(touch);
      const touchMode = touch.touchType === 'stylus' ? 'touch-stylus' : 'touch';
      startInteractionAt(point.x, point.y, touchMode);
    };

    const handleTouchMove = (event) => {
      if (activeTouchIdRef.current === null) {
        return;
      }

      const relevantTouches = Array.from(event.changedTouches || []).filter(
        (touch) => touch.identifier === activeTouchIdRef.current
      );
      if (!relevantTouches.length) {
        return;
      }

      event.preventDefault();
      const points = relevantTouches.map((touch) => {
        const point = getRelativePoint(touch);
        return buildNormalizedPoint(point.x, point.y);
      });
      moveInteractionPoints(points, relevantTouches.length);
    };

    const finishTouch = (event, cancel = false) => {
      if (activeTouchIdRef.current === null) {
        return;
      }

      const relevantTouches = Array.from(event.changedTouches || []).filter(
        (touch) => touch.identifier === activeTouchIdRef.current
      );
      if (!relevantTouches.length && event.type !== 'touchcancel') {
        return;
      }

      event.preventDefault();
      activeTouchIdRef.current = null;
      if (cancel) {
        cancelInteraction();
      } else {
        endInteraction();
      }
    };

    const handlePointerDown = (event) => {
      if (!enabledRef.current) {
        return;
      }

      activePointerIdRef.current = event.pointerId;
      if (typeof element.setPointerCapture === 'function') {
        element.setPointerCapture(event.pointerId);
      }
      event.preventDefault();

      const point = getRelativePoint(event);
      const inputMode = event.pointerType === 'pen' ? 'pointer-pen' : event.pointerType === 'touch' ? 'pointer-touch' : 'pointer';
      startInteractionAt(point.x, point.y, inputMode);
    };

    const handlePointerMove = (event) => {
      if (activePointerIdRef.current !== event.pointerId) {
        return;
      }

      event.preventDefault();
      const coalescedEvents =
        typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
      const sourceEvents = coalescedEvents.length ? coalescedEvents : [event];
      const points = sourceEvents.map((sourceEvent) => {
        const point = getRelativePoint(sourceEvent);
        return buildNormalizedPoint(point.x, point.y);
      });
      moveInteractionPoints(points, sourceEvents.length);

      // Draw predicted points as a faint lookahead — they get overwritten on the next real move
      if (currentToolRef.current === 'pen' && liveCanvasRef.current) {
        const predicted =
          typeof event.getPredictedEvents === 'function' ? event.getPredictedEvents() : [];
        if (predicted.length) {
          const predictedPoints = predicted.map((pe) => {
            const point = getRelativePoint(pe);
            return buildNormalizedPoint(point.x, point.y);
          });
          const allPoints = [...currentPathPointsRef.current, ...predictedPoints];
          const ctx = liveCanvasRef.current.getContext('2d', { desynchronized: true });
          if (ctx) {
            const dpr = window.devicePixelRatio || 1;
            ctx.save();
            ctx.strokeStyle = currentColorRef.current;
            ctx.lineWidth = currentStrokeWidthRef.current;
            ctx.globalAlpha = 0.4;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            if (tracePolylineOnCanvas(
              ctx,
              allPoints,
              normalizeWidthRef.current,
              normalizeHeightRef.current,
              imageOffsetXRef.current,
              imageOffsetYRef.current,
              Math.max(0, currentPathPointsRef.current.length - 1)
            )) {
              ctx.stroke();
            }
            ctx.restore();
          }
        }
      }
    };

    const finishPointer = (event, cancel = false) => {
      if (activePointerIdRef.current !== event.pointerId) {
        return;
      }

      event.preventDefault();
      activePointerIdRef.current = null;
      if (typeof element.releasePointerCapture === 'function') {
        try {
          element.releasePointerCapture(event.pointerId);
        } catch {}
      }

      if (cancel) {
        cancelInteraction();
      } else {
        endInteraction();
      }
    };

    const handlePointerUp = (event) => finishPointer(event, false);
    const handlePointerCancel = (event) => finishPointer(event, true);
    const handleTouchCancel = (event) => finishTouch(event, true);

    if (supportsPointer) {
      element.addEventListener('pointerdown', handlePointerDown);
      element.addEventListener('pointermove', handlePointerMove);
      element.addEventListener('pointerup', handlePointerUp);
      element.addEventListener('pointercancel', handlePointerCancel);
    } else {
      element.addEventListener('touchstart', handleTouchStart, touchOptions);
      element.addEventListener('touchmove', handleTouchMove, touchOptions);
      element.addEventListener('touchend', finishTouch, touchOptions);
      element.addEventListener('touchcancel', handleTouchCancel, touchOptions);
    }
    element.addEventListener('contextmenu', preventNativeUi, touchOptions);
    element.addEventListener('selectstart', preventNativeUi, touchOptions);
    element.addEventListener('dragstart', preventNativeUi, touchOptions);

    return () => {
      if (supportsPointer) {
        element.removeEventListener('pointerdown', handlePointerDown);
        element.removeEventListener('pointermove', handlePointerMove);
        element.removeEventListener('pointerup', handlePointerUp);
        element.removeEventListener('pointercancel', handlePointerCancel);
      } else {
        element.removeEventListener('touchstart', handleTouchStart, touchOptions);
        element.removeEventListener('touchmove', handleTouchMove, touchOptions);
        element.removeEventListener('touchend', finishTouch, touchOptions);
        element.removeEventListener('touchcancel', handleTouchCancel, touchOptions);
      }
      element.removeEventListener('contextmenu', preventNativeUi, touchOptions);
      element.removeEventListener('selectstart', preventNativeUi, touchOptions);
      element.removeEventListener('dragstart', preventNativeUi, touchOptions);
      activePointerIdRef.current = null;
      activeTouchIdRef.current = null;
    };
  }, [isWebCanvas]);

  // Get username for a user_id
  const getUsernameById = (userId) => {
    const user = presentUsers.find(u => u.user_id === userId);
    return user?.username || 'Unknown';
  };

  const NAMETAG_LINGER_MS = 800;

  // activeDrawingRef: Map<id, lastUpdateTime> — id present = nametag visible
  const activeDrawingRef = useRef(new Map());
  // lingerTimersRef: Map<id, timeoutId> — pending linger timers
  const lingerTimersRef = useRef(new Map());
  const [, forceRender] = useState(0);

  useEffect(() => {
    const now = Date.now();
    const seenAnnotationIds = new Set();

    pageAnnotations.forEach((annotation) => {
      if (annotation.type !== 'path' || annotation.user_id === currentUserId) return;
      seenAnnotationIds.add(annotation.id);
      const lastPoint = annotation.path?.points?.[annotation.path.points.length - 1] || null;

      if (annotation._isTemp === true) {
        // Cancel any pending linger timer — stroke is still in progress
        if (lingerTimersRef.current.has(annotation.id)) {
          clearTimeout(lingerTimersRef.current.get(annotation.id));
          lingerTimersRef.current.delete(annotation.id);
        }
        if (!lastPoint) {
          return;
        }

        const signature = `${annotation.path.points.length}:${lastPoint.x.toFixed(3)}:${lastPoint.y.toFixed(3)}`;
        const previousSignature = tempSignaturesRef.current.get(annotation.id);
        const existingEntry = activeDrawingRef.current.get(annotation.id);

        tempSignaturesRef.current.set(annotation.id, signature);
        activeDrawingRef.current.set(annotation.id, {
          userId: annotation.user_id,
          point: lastPoint,
          lastSeen: previousSignature !== signature || !existingEntry ? now : existingEntry.lastSeen,
        });
      } else if (activeDrawingRef.current.has(annotation.id) && !lingerTimersRef.current.has(annotation.id)) {
        // Stroke just committed — start linger timer
        const timer = setTimeout(() => {
          activeDrawingRef.current.delete(annotation.id);
          tempSignaturesRef.current.delete(annotation.id);
          lingerTimersRef.current.delete(annotation.id);
          forceRender((prev) => prev + 1);
        }, NAMETAG_LINGER_MS);
        lingerTimersRef.current.set(annotation.id, timer);
      }
    });

    activeDrawingRef.current.forEach((_, id) => {
      if (!seenAnnotationIds.has(id) && !lingerTimersRef.current.has(id)) {
        const timer = setTimeout(() => {
          activeDrawingRef.current.delete(id);
          tempSignaturesRef.current.delete(id);
          lingerTimersRef.current.delete(id);
          forceRender((prev) => prev + 1);
        }, NAMETAG_LINGER_MS);
        lingerTimersRef.current.set(id, timer);
      }
    });

    // Fallback: clear stale entries that never got a final update (e.g. disconnected user)
    const fallback = setTimeout(() => {
      const cutoff = Date.now();
      let changed = false;
      activeDrawingRef.current.forEach((entry, id) => {
        if (cutoff - entry.lastSeen > 1500 && !lingerTimersRef.current.has(id)) {
          activeDrawingRef.current.delete(id);
          tempSignaturesRef.current.delete(id);
          changed = true;
        }
      });
      if (changed) forceRender((prev) => prev + 1);
    }, 1500);

    return () => clearTimeout(fallback);
  }, [pageAnnotations, currentUserId]);

  // Show at most one live name tag per remote user, pinned to their latest active stroke.
  const remoteTempAnnotations = pageAnnotations.reduce((acc, annotation) => {
    if (annotation.type !== 'path' || !annotation.path) return acc;
    if (annotation.user_id === currentUserId) return acc;
    if (hiddenAnnotationUsers.has(annotation.user_id)) return acc;

    const hasPoints = annotation.path.points && annotation.path.points.length > 0;
    const activeEntry = activeDrawingRef.current.get(annotation.id);
    if (!hasPoints || !activeEntry?.point) {
      return acc;
    }

    const existing = acc.get(annotation.user_id);
    if (!existing || activeEntry.lastSeen >= existing.lastSeen) {
      acc.set(annotation.user_id, {
        annotation,
        point: activeEntry.point,
        lastSeen: activeEntry.lastSeen,
      });
    }

    return acc;
  }, new Map());

  return (
    <View
      ref={containerRef}
      style={[styles.container, { width, height }]}
      {...(!isWebCanvas ? panResponder.panHandlers : {})}
      pointerEvents={enabled ? 'auto' : 'none'}
    >
      {isWebCanvas ? (
        <>
          <canvas
            ref={staticCanvasRef}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              zIndex: 1,
              pointerEvents: 'none',
            }}
          />
          <canvas
            ref={liveCanvasRef}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              zIndex: 2,
              pointerEvents: 'none',
            }}
          />
        </>
      ) : (
        <Svg width={width} height={height} style={styles.svg}>
          {/* Render saved annotations */}
          {pageAnnotations.map((annotation) => {
            if (annotation.type === 'path' && annotation.path) {
              const pathString =
                annotation.path._frozenPathString ||
                pointsToCommittedPathString(annotation.path.points);

              return (
                <Path
                  key={annotation.id}
                  d={pathString}
                  stroke={annotation.path.color}
                  strokeWidth={annotation.path.strokeWidth}
                  opacity={annotation.path.opacity}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              );
            }

            if (annotation.type === 'text' && annotation.text) {
              return (
                <SvgText
                  key={annotation.id}
                  x={(annotation.text.position.x / 100) * normalizeWidth + imageOffsetX}
                  y={(annotation.text.position.y / 100) * normalizeHeight + imageOffsetY}
                  fontSize={annotation.text.fontSize}
                  fill={annotation.text.color}
                  fontFamily="Afacad_400Regular"
                >
                  {annotation.text.content}
                </SvgText>
              );
            }

            if (annotation.type === 'shape' && annotation.shape) {
              const { shapeType, bounds, color, strokeWidth } = annotation.shape;
              const x = (bounds.x / 100) * normalizeWidth + imageOffsetX;
              const y = (bounds.y / 100) * normalizeHeight + imageOffsetY;
              const w = (bounds.width / 100) * normalizeWidth;
              const h = (bounds.height / 100) * normalizeHeight;

              if (shapeType === 'circle') {
                const radius = Math.min(w, h) / 2;
                return (
                  <Circle
                    key={annotation.id}
                    cx={x + w / 2}
                    cy={y + h / 2}
                    r={radius}
                    stroke={color}
                    strokeWidth={strokeWidth}
                    fill="none"
                  />
                );
              }

              if (shapeType === 'rect') {
                return (
                  <Rect
                    key={annotation.id}
                    x={x}
                    y={y}
                    width={w}
                    height={h}
                    stroke={color}
                    strokeWidth={strokeWidth}
                    fill="none"
                  />
                );
              }
            }

            return null;
          })}

          {/* Render current path being drawn */}
          {currentPathPoints.length > 0 && (
            <Path
              d={pointsToLivePathString(currentPathPoints)}
              stroke={currentColor}
              strokeWidth={currentStrokeWidth}
              opacity={1.0}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Render eraser cursor */}
          {eraserPosition && currentTool === 'eraser' && (
            <Circle
              cx={eraserPosition.x}
              cy={eraserPosition.y}
              r={eraserRadius}
              stroke={COLORS.darkBrown}
              strokeWidth={2}
              fill="none"
              opacity={0.5}
            />
          )}
        </Svg>
      )}

      {/* Username labels — clamped to stay within the drawing area */}
      {Array.from(remoteTempAnnotations.values()).map(({ annotation, point }) => {
        const rawX = (point.x / 100) * normalizeWidth + imageOffsetX;
        const rawY = (point.y / 100) * normalizeHeight + imageOffsetY;

        const LABEL_W = 110;
        const LABEL_H = 24;
        const MARGIN = 6;

        const labelLeft = Math.min(Math.max(rawX + 10, MARGIN), width - LABEL_W - MARGIN);
        const labelTop = Math.min(Math.max(rawY - LABEL_H - 4, MARGIN), height - LABEL_H - MARGIN);

        return (
          <View
            key={`label-${annotation.id}`}
            style={[styles.usernameLabel, { left: labelLeft, top: labelTop }]}
            pointerEvents="none"
          >
            <Text style={styles.usernameLabelText}>
              {getUsernameById(annotation.user_id)}
            </Text>
          </View>
        );
      })}

      {isWebCanvas && config.annotationDebug.showInkDebug ? (
        <View style={styles.debugOverlay} pointerEvents="none">
          <Text style={styles.debugOverlayText}>
            {`ink debug\nmode: ${debugOverlay.inputMode || 'unknown'}\nactive: ${debugOverlay.strokeActive ? 'yes' : 'no'}\npts: ${debugOverlay.totalPoints}  pts/s: ${debugOverlay.pointsPerSecond}\npts in 120ms: ${debugOverlay.earlyWindowPoints}\nmoves: ${debugOverlay.pointerMoves}\ncoalesced total: ${debugOverlay.coalescedEvents}\ncoalesced avg: ${debugOverlay.coalescedAvg.toFixed(1)}\nfirst followup gap: ${debugOverlay.firstFollowupGapMs}ms\nlast gap: ${debugOverlay.lastGapMs}ms\nmax gap: ${debugOverlay.maxGapMs}ms`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    zIndex: 100000,
    overflow: 'visible',
  },
  svg: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 1,
  },
  usernameLabel: {
    position: 'absolute',
    backgroundColor: COLORS.darkBrown,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    zIndex: 2,
    elevation: 999,
  },
  usernameLabelText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 12,
    color: COLORS.beige,
  },
  debugOverlay: {
    position: 'absolute',
    top: 10,
    left: 10,
    zIndex: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    maxWidth: 220,
  },
  debugOverlayText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 12,
    lineHeight: 15,
    color: '#FFFFFF',
  },
});
