import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import {
  faPen,
  faEraser,
  faFont,
  faTrash,
  faCircle,
} from '@fortawesome/free-solid-svg-icons';

const COLORS = {
  beige: '#FAF7F0',
  lightBrown: '#A9988F',
  darkBrown: '#58392F',
};

const ANNOTATION_COLORS = [
  { name: 'Red', value: '#D94848' },
  { name: 'Blue', value: '#4A8FD9' },
  { name: 'Green', value: '#48A848' },
  { name: 'Purple', value: '#9448D9' },
];

const STROKE_WIDTHS = [
  { name: 'Thin', value: 2 },
  { name: 'Medium', value: 4 },
  { name: 'Thick', value: 6 },
];

export default function AnnotationToolbar({
  currentTool,
  currentColor,
  currentStrokeWidth,
  enabled,
  onToolChange,
  onColorChange,
  onStrokeWidthChange,
  onClearAll,
  onToggleEnabled,
}) {
  return (
    <View style={styles.container}>
      {/* Enable/Disable Toggle */}
      <TouchableOpacity
        style={[styles.toolButton, enabled && styles.toolButtonActive]}
        onPress={onToggleEnabled}
      >
        <FontAwesomeIcon
          icon={faPen}
          size={20}
          color={enabled ? COLORS.beige : COLORS.darkBrown}
        />
        <Text style={[styles.toolButtonText, enabled && styles.toolButtonTextActive]}>
          {enabled ? 'Annotate' : 'Annotate'}
        </Text>
      </TouchableOpacity>

      {enabled && (
        <>
          {/* Tool Selection */}
          <View style={styles.toolGroup}>
            <TouchableOpacity
              style={[
                styles.iconButton,
                currentTool === 'pen' && styles.iconButtonActive,
              ]}
              onPress={() => onToolChange('pen')}
            >
              <FontAwesomeIcon
                icon={faPen}
                size={18}
                color={currentTool === 'pen' ? COLORS.beige : COLORS.darkBrown}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.iconButton,
                currentTool === 'eraser' && styles.iconButtonActive,
              ]}
              onPress={() => onToolChange('eraser')}
            >
              <FontAwesomeIcon
                icon={faEraser}
                size={18}
                color={currentTool === 'eraser' ? COLORS.beige : COLORS.darkBrown}
              />
            </TouchableOpacity>
          </View>

          {/* Color Picker */}
          <View style={styles.colorGroup}>
            {ANNOTATION_COLORS.map((color) => (
              <TouchableOpacity
                key={color.value}
                style={[
                  styles.colorButton,
                  { backgroundColor: color.value },
                  currentColor === color.value && styles.colorButtonActive,
                ]}
                onPress={() => onColorChange(color.value)}
              >
                {currentColor === color.value && (
                  <View style={styles.colorButtonCheckmark} />
                )}
              </TouchableOpacity>
            ))}
          </View>

          {/* Stroke Width */}
          <View style={styles.strokeGroup}>
            {STROKE_WIDTHS.map((stroke) => (
              <TouchableOpacity
                key={stroke.value}
                style={[
                  styles.strokeButton,
                  currentStrokeWidth === stroke.value && styles.strokeButtonActive,
                ]}
                onPress={() => onStrokeWidthChange(stroke.value)}
              >
                <View
                  style={[
                    styles.strokeIndicator,
                    {
                      width: stroke.value * 3,
                      height: stroke.value * 3,
                      backgroundColor:
                        currentStrokeWidth === stroke.value
                          ? COLORS.beige
                          : COLORS.darkBrown,
                    },
                  ]}
                />
              </TouchableOpacity>
            ))}
          </View>

          {/* Clear All */}
          <TouchableOpacity style={styles.clearButton} onPress={onClearAll}>
            <FontAwesomeIcon icon={faTrash} size={18} color={COLORS.beige} />
            <Text style={styles.clearButtonText}>Clear</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.lightBrown,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    flexWrap: 'wrap',
  },
  toolButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.beige,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 8,
  },
  toolButtonActive: {
    backgroundColor: COLORS.darkBrown,
  },
  toolButtonText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 16,
    color: COLORS.darkBrown,
  },
  toolButtonTextActive: {
    color: COLORS.beige,
  },
  toolGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  iconButton: {
    width: 40,
    height: 40,
    backgroundColor: COLORS.beige,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonActive: {
    backgroundColor: COLORS.darkBrown,
  },
  colorGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  colorButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorButtonActive: {
    borderColor: COLORS.beige,
    borderWidth: 3,
  },
  colorButtonCheckmark: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
  },
  strokeGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  strokeButton: {
    width: 40,
    height: 40,
    backgroundColor: COLORS.beige,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  strokeButtonActive: {
    backgroundColor: COLORS.darkBrown,
  },
  strokeIndicator: {
    borderRadius: 999,
  },
  clearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#D94848',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  clearButtonText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 14,
    color: COLORS.beige,
  },
});
