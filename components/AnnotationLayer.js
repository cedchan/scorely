import { useEffect, useRef, useState, useMemo } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
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
  annotations,
  currentTool,
  currentColor,
  currentStrokeWidth,
  onAnnotationCreated,
  onAnnotationUpdated,
  enabled = true,
  style,
}) {
  const [currentPathPoints, setCurrentPathPoints] = useState([]);
  const currentPathPointsRef = useRef([]);
  const annotationsToEraseRef = useRef([]);
  const tempAnnotationIdRef = useRef(null);
  const updateThrottleRef = useRef(null);

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
      user_id: '',
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
    // Clear existing throttle
    if (updateThrottleRef.current) {
      clearTimeout(updateThrottleRef.current);
    }

    // Throttle updates to every 50ms
    updateThrottleRef.current = setTimeout(() => {
      sendLiveUpdate(points);
      updateThrottleRef.current = null;
    }, 50);
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
          // Convert point from percentage to pixels
          const pointX = (point.x / 100) * width;
          const pointY = (point.y / 100) * height;
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
        // Start new path - store as percentages
        const initialPoints = [{
          x: (locationX / width) * 100,
          y: (locationY / height) * 100
        }];
        setCurrentPathPoints(initialPoints);

        // Create temporary annotation ID
        tempAnnotationIdRef.current = `temp-${Date.now()}`;

        // Send initial live update
        sendLiveUpdate(initialPoints);
      } else if (currentTool === 'eraser') {
        // Start tracking annotations to erase
        annotationsToEraseRef.current = [];
        checkForAnnotationsToErase(locationX, locationY);
      }
    },

    onPanResponderMove: (event) => {
      if (!enabled) return;

      const { locationX, locationY } = event.nativeEvent;

      if (currentTool === 'pen') {
        // Add point to current path - store as percentages
        const newPoints = [
          ...currentPathPointsRef.current,
          {
            x: (locationX / width) * 100,
            y: (locationY / height) * 100
          },
        ];
        setCurrentPathPoints(newPoints);

        // Send throttled live update
        sendThrottledLiveUpdate(newPoints);
      } else if (currentTool === 'eraser') {
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

        // Create final annotation with the temporary ID (will replace temporary one)
        const annotation = {
          id: tempAnnotationIdRef.current,
          job_id: '', // Will be set by parent
          page_number: pageNumber,
          type: 'path',
          user_id: '', // Will be set by parent
          timestamp: Date.now() / 1000,
          path: {
            points: currentPathPointsRef.current,
            color: currentColor,
            strokeWidth: currentStrokeWidth,
            opacity: 1.0,
          },
          _isFinal: true, // Flag to indicate this is the final version
        };

        onAnnotationCreated(annotation);

        // Clear current path
        setCurrentPathPoints([]);
        tempAnnotationIdRef.current = null;
      } else if (currentTool === 'eraser') {
        // Annotations were already erased during the gesture
        annotationsToEraseRef.current = [];
      }
    },

    onPanResponderTerminate: () => {
      // Reset on gesture cancel
      setCurrentPathPoints([]);
      annotationsToEraseRef.current = [];
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

    // Convert first point from percentage to pixels
    const firstX = (points[0].x / 100) * width;
    const firstY = (points[0].y / 100) * height;
    let pathString = `M ${firstX} ${firstY}`;

    for (let i = 1; i < points.length; i++) {
      // Convert each point from percentage to pixels
      const px = (points[i].x / 100) * width;
      const py = (points[i].y / 100) * height;
      pathString += ` L ${px} ${py}`;
    }

    return pathString;
  };

  // Filter annotations for current page
  const pageAnnotations = annotations.filter(
    (ann) => ann.page_number === pageNumber
  );

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
                x={(annotation.text.position.x / 100) * width}
                y={(annotation.text.position.y / 100) * height}
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
            const x = (bounds.x / 100) * width;
            const y = (bounds.y / 100) * height;
            const w = (bounds.width / 100) * width;
            const h = (bounds.height / 100) * height;

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
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    zIndex: 10,
  },
  svg: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});
