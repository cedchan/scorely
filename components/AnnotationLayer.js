import { useEffect, useRef, useState } from 'react';
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
}) {
  const [currentPath, setCurrentPath] = useState(null);
  const [currentPathPoints, setCurrentPathPoints] = useState([]);
  const panResponder = useRef(null);

  useEffect(() => {
    panResponder.current = PanResponder.create({
      onStartShouldSetPanResponder: () => enabled,
      onMoveShouldSetPanResponder: () => enabled,

      onPanResponderGrant: (event) => {
        if (!enabled) return;

        const { locationX, locationY } = event.nativeEvent;

        if (currentTool === 'pen') {
          // Start new path
          setCurrentPathPoints([{ x: locationX, y: locationY }]);
        }
      },

      onPanResponderMove: (event) => {
        if (!enabled) return;

        const { locationX, locationY } = event.nativeEvent;

        if (currentTool === 'pen') {
          // Add point to current path
          setCurrentPathPoints((points) => [
            ...points,
            { x: locationX, y: locationY },
          ]);
        }
      },

      onPanResponderRelease: () => {
        if (!enabled) return;

        if (currentTool === 'pen' && currentPathPoints.length > 0) {
          // Create annotation from current path
          const annotation = {
            id: `temp-${Date.now()}`,
            job_id: '', // Will be set by parent
            page_number: pageNumber,
            type: 'path',
            user_id: '', // Will be set by parent
            timestamp: Date.now() / 1000,
            path: {
              points: currentPathPoints,
              color: currentColor,
              strokeWidth: currentStrokeWidth,
              opacity: 1.0,
            },
          };

          onAnnotationCreated(annotation);

          // Clear current path
          setCurrentPathPoints([]);
          setCurrentPath(null);
        }
      },

      onPanResponderTerminate: () => {
        // Reset on gesture cancel
        setCurrentPathPoints([]);
        setCurrentPath(null);
      },
    });
  }, [
    enabled,
    currentTool,
    currentColor,
    currentStrokeWidth,
    currentPathPoints,
    pageNumber,
    onAnnotationCreated,
  ]);

  // Convert points array to SVG path string
  const pointsToPathString = (points) => {
    if (!points || points.length === 0) return '';

    let pathString = `M ${points[0].x} ${points[0].y}`;

    for (let i = 1; i < points.length; i++) {
      pathString += ` L ${points[i].x} ${points[i].y}`;
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
      {...(panResponder.current?.panHandlers || {})}
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
                x={annotation.text.position.x}
                y={annotation.text.position.y}
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

            if (shapeType === 'circle') {
              const radius = Math.min(bounds.width, bounds.height) / 2;
              return (
                <Circle
                  key={annotation.id}
                  cx={bounds.x + bounds.width / 2}
                  cy={bounds.y + bounds.height / 2}
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
                  x={bounds.x}
                  y={bounds.y}
                  width={bounds.width}
                  height={bounds.height}
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
    top: 0,
    left: 0,
    zIndex: 10,
  },
  svg: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});
