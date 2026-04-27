import React, { useEffect, useRef, useState, useMemo } from 'react';
import { PanResponder, StyleSheet, View, Text } from 'react-native';
import Svg, { Path, Circle, Rect, Text as SvgText } from 'react-native-svg';

const COLORS = {
  beige: '#FAF7F0',
  lightBrown: '#A9988F',
  darkBrown: '#58392F',
};

// Pure function — safe to call outside component, including at freeze time on release
function pointsToPathStringStatic(points, normalizeWidth, normalizeHeight, imageOffsetX, imageOffsetY) {
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

  // Catmull-Rom → cubic bezier
  for (let i = 0; i < px.length - 1; i++) {
    const p0 = px[Math.max(i - 1, 0)];
    const p1 = px[i];
    const p2 = px[i + 1];
    const p3 = px[Math.min(i + 2, px.length - 1)];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`;
  }

  return d;
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
  const annotationsToEraseRef = useRef([]);
  const tempAnnotationIdRef = useRef(null);
  const updateThrottleRef = useRef(null);
  const lastUpdateTimeRef = useRef(0);
  const pendingUpdateRef = useRef(null);
  const eraserRadius = 20;

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

  // panResponder is created once and never recreated — all values read via refs
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => enabledRef.current,
    onMoveShouldSetPanResponder: () => enabledRef.current,

    onPanResponderGrant: (event) => {
      if (!enabledRef.current) return;
      const { locationX, locationY } = event.nativeEvent;

      if (currentToolRef.current === 'pen') {
        const adjustedX = locationX - imageOffsetXRef.current;
        const adjustedY = locationY - imageOffsetYRef.current;
        const initialPoints = [{
          x: (adjustedX / normalizeWidthRef.current) * 100,
          y: (adjustedY / normalizeHeightRef.current) * 100,
        }];
        currentPathPointsRef.current = initialPoints;
        setCurrentPathPoints(initialPoints);
        tempAnnotationIdRef.current = `temp-${Date.now()}`;
        sendLiveUpdate(initialPoints);
      } else if (currentToolRef.current === 'eraser') {
        annotationsToEraseRef.current = [];
        setEraserPosition({ x: locationX, y: locationY });
        checkForAnnotationsToErase(locationX, locationY);
      }
    },

    onPanResponderMove: (event) => {
      if (!enabledRef.current) return;
      const { locationX, locationY } = event.nativeEvent;

      if (currentToolRef.current === 'pen') {
        const adjustedX = locationX - imageOffsetXRef.current;
        const adjustedY = locationY - imageOffsetYRef.current;
        const newPoints = [
          ...currentPathPointsRef.current,
          {
            x: (adjustedX / normalizeWidthRef.current) * 100,
            y: (adjustedY / normalizeHeightRef.current) * 100,
          },
        ];
        currentPathPointsRef.current = newPoints;
        setCurrentPathPoints(newPoints);
        sendThrottledLiveUpdate(newPoints);
      } else if (currentToolRef.current === 'eraser') {
        setEraserPosition({ x: locationX, y: locationY });
        checkForAnnotationsToErase(locationX, locationY);
      }
    },

    onPanResponderRelease: () => {
      if (!enabledRef.current) return;

      if (currentToolRef.current === 'pen' && currentPathPointsRef.current.length > 0) {
        if (updateThrottleRef.current) {
          clearTimeout(updateThrottleRef.current);
          updateThrottleRef.current = null;
        }

        const finalPoints = currentPathPointsRef.current;
        const frozenPathString = pointsToPathStringStatic(
          finalPoints,
          normalizeWidthRef.current,
          normalizeHeightRef.current,
          imageOffsetXRef.current,
          imageOffsetYRef.current
        );

        onAnnotationUpdatedRef.current({
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
        setCurrentPathPoints([]);
        tempAnnotationIdRef.current = null;
      } else if (currentToolRef.current === 'eraser') {
        annotationsToEraseRef.current = [];
        setEraserPosition(null);
      }
    },

    onPanResponderTerminate: () => {
      currentPathPointsRef.current = [];
      setCurrentPathPoints([]);
      annotationsToEraseRef.current = [];
      setEraserPosition(null);
    },
  }), []);  // Empty deps — stable forever, reads via refs

  // Catmull-Rom → cubic bezier, parameterized (used both inline and at freeze time)
  const pointsToPathString = (points) =>
    pointsToPathStringStatic(points, normalizeWidth, normalizeHeight, imageOffsetX, imageOffsetY);

  // Filter annotations for current page and visible users
  const pageAnnotations = annotations.filter((ann) => {
    if (ann.page_number !== pageNumber) return false;
    if (hiddenAnnotationUsers.has(ann.user_id)) return false;
    return true;
  });

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

    pageAnnotations.forEach((annotation) => {
      if (annotation.type !== 'path' || annotation.user_id === currentUserId) return;

      if (annotation._isTemp === true) {
        // Cancel any pending linger timer — stroke is still in progress
        if (lingerTimersRef.current.has(annotation.id)) {
          clearTimeout(lingerTimersRef.current.get(annotation.id));
          lingerTimersRef.current.delete(annotation.id);
        }
        activeDrawingRef.current.set(annotation.id, now);
      } else if (activeDrawingRef.current.has(annotation.id) && !lingerTimersRef.current.has(annotation.id)) {
        // Stroke just committed — start linger timer
        const timer = setTimeout(() => {
          activeDrawingRef.current.delete(annotation.id);
          lingerTimersRef.current.delete(annotation.id);
          forceRender((prev) => prev + 1);
        }, NAMETAG_LINGER_MS);
        lingerTimersRef.current.set(annotation.id, timer);
      }
    });

    // Fallback: clear stale entries that never got a final update (e.g. disconnected user)
    const fallback = setTimeout(() => {
      const cutoff = Date.now();
      let changed = false;
      activeDrawingRef.current.forEach((timestamp, id) => {
        if (cutoff - timestamp > 1500 && !lingerTimersRef.current.has(id)) {
          activeDrawingRef.current.delete(id);
          changed = true;
        }
      });
      if (changed) forceRender((prev) => prev + 1);
    }, 1500);

    return () => clearTimeout(fallback);
  }, [pageAnnotations, currentUserId]);

  // Find remote temp annotations - only show while actively drawing
  const remoteTempAnnotations = pageAnnotations.filter((annotation) => {
    if (annotation.type !== 'path' || !annotation.path) return false;
    if (annotation.user_id === currentUserId) return false;

    const hasPoints = annotation.path.points && annotation.path.points.length > 0;
    const isActivelyDrawing = activeDrawingRef.current.has(annotation.id);

    return hasPoints && isActivelyDrawing;
  });

  return (
    <View
      style={[styles.container, { width, height }]}
      {...panResponder.panHandlers}
      pointerEvents={enabled ? 'auto' : 'none'}
    >
      <Svg width={width} height={height} style={styles.svg}>
        {/* Render saved annotations */}
        {pageAnnotations.map((annotation) => {
          if (annotation.type === 'path' && annotation.path) {
            const pathString = annotation.path._frozenPathString || pointsToPathString(annotation.path.points);

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
            d={pointsToPathString(currentPathPoints)}
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

      {/* Username labels — clamped to stay within the drawing area */}
      {remoteTempAnnotations.map((annotation) => {
        const lastPoint = annotation.path.points[annotation.path.points.length - 1];
        const rawX = (lastPoint.x / 100) * normalizeWidth + imageOffsetX;
        const rawY = (lastPoint.y / 100) * normalizeHeight + imageOffsetY;

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
});
