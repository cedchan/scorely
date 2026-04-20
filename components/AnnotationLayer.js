import React, { useEffect, useRef, useState, useMemo } from 'react';
import { PanResponder, StyleSheet, View, Text } from 'react-native';
import Svg, { Path, Circle, Rect, Text as SvgText } from 'react-native-svg';

const COLORS = {
  beige: '#FAF7F0',
  lightBrown: '#A9988F',
  darkBrown: '#58392F',
};

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

  // Keep ref updated with current points
  useEffect(() => {
    currentPathPointsRef.current = currentPathPoints;
  }, [currentPathPoints]);

  const sendLiveUpdate = (points) => {
    if (!onAnnotationUpdated || !tempAnnotationIdRef.current) return;

    const tempAnnotation = {
      id: tempAnnotationIdRef.current,
      job_id: '',
      page_number: pageNumber,
      type: 'path',
      user_id: currentUserId,
      timestamp: Date.now() / 1000,
      path: {
        points,
        color: currentColor,
        strokeWidth: currentStrokeWidth,
        opacity: 1.0,
      },
      _isTemp: true, // Flag to indicate this is a temporary live update
    };

    onAnnotationUpdated(tempAnnotation);
  };

  const sendThrottledLiveUpdate = (points) => {
    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdateTimeRef.current;
    const UPDATE_INTERVAL = 16; // ~60fps (16ms)

    // Store pending update
    pendingUpdateRef.current = points;

    // If enough time has passed, send immediately
    if (timeSinceLastUpdate >= UPDATE_INTERVAL) {
      sendLiveUpdate(points);
      lastUpdateTimeRef.current = now;
      pendingUpdateRef.current = null;
    } else {
      // Schedule update for next interval
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
  };

  const checkForAnnotationsToErase = (x, y) => {
    const eraserRadius = 20; // pixels
    const pageAnnotations = annotations.filter(
      (ann) => ann.page_number === pageNumber
    );

    pageAnnotations.forEach((annotation) => {
      // Skip if already marked for erasure
      if (annotationsToEraseRef.current.includes(annotation.id)) {
        return;
      }

      // Check if eraser touches this annotation
      if (annotation.type === 'path' && annotation.path) {
        const touched = annotation.path.points.some((point) => {
          // Convert point from percentage to pixels using image dimensions, then add offset
          const pointX = (point.x / 100) * normalizeWidth + imageOffsetX;
          const pointY = (point.y / 100) * normalizeHeight + imageOffsetY;
          const distance = Math.sqrt(
            Math.pow(pointX - x, 2) + Math.pow(pointY - y, 2)
          );
          return distance < eraserRadius;
        });

        if (touched && onAnnotationUpdated) {
          annotationsToEraseRef.current.push(annotation.id);
          // Mark for deletion
          const deletedAnnotation = { ...annotation, _deleted: true };
          onAnnotationUpdated(deletedAnnotation);
        }
      }
    });
  };

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => enabled,
    onMoveShouldSetPanResponder: () => enabled,

    onPanResponderGrant: (event) => {
      if (!enabled) return;

      const { locationX, locationY } = event.nativeEvent;

      if (currentTool === 'pen') {
        // Adjust for image offset and store as percentages relative to image dimensions
        const adjustedX = locationX - imageOffsetX;
        const adjustedY = locationY - imageOffsetY;

        const initialPoints = [{
          x: (adjustedX / normalizeWidth) * 100,
          y: (adjustedY / normalizeHeight) * 100
        }];
        setCurrentPathPoints(initialPoints);

        // Create temporary annotation ID
        tempAnnotationIdRef.current = `temp-${Date.now()}`;

        // Send initial live update
        sendLiveUpdate(initialPoints);
      } else if (currentTool === 'eraser') {
        // Start tracking annotations to erase
        annotationsToEraseRef.current = [];
        setEraserPosition({ x: locationX, y: locationY });
        checkForAnnotationsToErase(locationX, locationY);
      }
    },

    onPanResponderMove: (event) => {
      if (!enabled) return;

      const { locationX, locationY } = event.nativeEvent;

      if (currentTool === 'pen') {
        // Adjust for image offset and store as percentages relative to image dimensions
        const adjustedX = locationX - imageOffsetX;
        const adjustedY = locationY - imageOffsetY;

        const newPoints = [
          ...currentPathPointsRef.current,
          {
            x: (adjustedX / normalizeWidth) * 100,
            y: (adjustedY / normalizeHeight) * 100
          },
        ];
        setCurrentPathPoints(newPoints);

        // Send throttled live update
        sendThrottledLiveUpdate(newPoints);
      } else if (currentTool === 'eraser') {
        setEraserPosition({ x: locationX, y: locationY });
        checkForAnnotationsToErase(locationX, locationY);
      }
    },

    onPanResponderRelease: () => {
      if (!enabled) return;

      if (currentTool === 'pen' && currentPathPointsRef.current.length > 0) {
        // Clear throttle timer
        if (updateThrottleRef.current) {
          clearTimeout(updateThrottleRef.current);
          updateThrottleRef.current = null;
        }

        // Send final version as an update (since temp versions already exist)
        const annotation = {
          id: tempAnnotationIdRef.current,
          job_id: '', // Will be set by parent
          page_number: pageNumber,
          type: 'path',
          user_id: currentUserId,
          timestamp: Date.now() / 1000,
          path: {
            points: currentPathPointsRef.current,
            color: currentColor,
            strokeWidth: currentStrokeWidth,
            opacity: 1.0,
          },
          _isFinal: true, // Flag to indicate this is the final version
        };

        // Use onAnnotationUpdated for final version to preserve the annotation
        // and signal that drawing is complete
        onAnnotationUpdated(annotation);

        // Clear current path
        setCurrentPathPoints([]);
        tempAnnotationIdRef.current = null;
      } else if (currentTool === 'eraser') {
        // Annotations were already erased during the gesture
        annotationsToEraseRef.current = [];
        setEraserPosition(null);
      }
    },

    onPanResponderTerminate: () => {
      // Reset on gesture cancel
      setCurrentPathPoints([]);
      annotationsToEraseRef.current = [];
      setEraserPosition(null);
    },
  }), [
    enabled,
    currentTool,
    currentColor,
    currentStrokeWidth,
    pageNumber,
    onAnnotationCreated,
    onAnnotationUpdated,
    width,
    height,
    annotations, // Needed for checkForAnnotationsToErase
  ]);

  // Convert points array to SVG path string, converting from percentages to pixels
  const pointsToPathString = (points) => {
    if (!points || points.length === 0) return '';

    // Convert first point from percentage to pixels using image dimensions, then add offset
    const firstX = (points[0].x / 100) * normalizeWidth + imageOffsetX;
    const firstY = (points[0].y / 100) * normalizeHeight + imageOffsetY;
    let pathString = `M ${firstX} ${firstY}`;

    for (let i = 1; i < points.length; i++) {
      // Convert each point from percentage to pixels using image dimensions, then add offset
      const px = (points[i].x / 100) * normalizeWidth + imageOffsetX;
      const py = (points[i].y / 100) * normalizeHeight + imageOffsetY;
      pathString += ` L ${px} ${py}`;
    }

    return pathString;
  };

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

  // Track which annotations are actively being drawn (received updates recently)
  const activeDrawingRef = useRef(new Map()); // Map<annotationId, lastUpdateTime>
  const [, forceRender] = useState(0);

  useEffect(() => {
    const now = Date.now();

    // Log all remote annotations and their _isTemp status
    const remoteAnnotations = pageAnnotations.filter(a =>
      a.type === 'path' && a.user_id !== currentUserId
    );

    if (remoteAnnotations.length > 0) {
      console.log('[AnnotationLayer] Remote annotations details:');
      remoteAnnotations.forEach((a, idx) => {
        console.log(`  [${idx}] id=${a.id}, _isTemp=${a._isTemp}, _isFinal=${a._isFinal}, hasFlag=${a.hasOwnProperty('_isTemp')}, points=${a.path?.points?.length}`);
        console.log(`       Full keys:`, Object.keys(a));
      });
    }

    // Update timestamps for annotations with _isTemp flag
    pageAnnotations.forEach((annotation) => {
      if (annotation.type === 'path' &&
          annotation.user_id !== currentUserId &&
          annotation._isTemp === true) {
        console.log('Setting active drawing timestamp for:', annotation.id);
        activeDrawingRef.current.set(annotation.id, now);
      }
    });

    console.log('Active drawing map:', Array.from(activeDrawingRef.current.keys()));

    // Clean up annotations that haven't been updated in 500ms
    const timeout = setTimeout(() => {
      const cleanupTime = Date.now();
      let hasChanges = false;

      activeDrawingRef.current.forEach((timestamp, id) => {
        if (cleanupTime - timestamp > 500) {
          console.log('Removing from active drawing:', id);
          activeDrawingRef.current.delete(id);
          hasChanges = true;
        }
      });

      if (hasChanges) {
        forceRender(prev => prev + 1);
      }
    }, 500);

    return () => clearTimeout(timeout);
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
            const pathString = pointsToPathString(annotation.path.points);

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

      {/* Username labels overlay - rendered outside SVG for proper z-index */}
      {remoteTempAnnotations.map((annotation) => {
        const lastPoint = annotation.path.points[annotation.path.points.length - 1];
        const labelX = (lastPoint.x / 100) * normalizeWidth + imageOffsetX;
        const labelY = (lastPoint.y / 100) * normalizeHeight + imageOffsetY;

        return (
          <View
            key={`label-${annotation.id}`}
            style={[
              styles.usernameLabel,
              {
                left: labelX + 10,
                top: labelY - 25,
              },
            ]}
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
