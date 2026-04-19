import { StyleSheet, Text, TouchableOpacity, View, Switch } from 'react-native';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import {
  faPen,
  faEraser,
  faFont,
  faTrash,
  faCircle,
  faEye,
  faChevronDown,
  faChevronUp,
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
  annotations = [],
  currentUserId = '',
  currentUsername = '',
  presentUsers = [],
  hiddenAnnotationUsers = new Set(),
  showUserVisibilityDropdown = false,
  onToggleDropdown = () => {},
  onToggleUserVisibility = () => {},
}) {

  // Get all unique users who have made annotations
  const usersWithAnnotations = Array.from(
    new Set(annotations.map(ann => ann.user_id).filter(Boolean))
  ).map(userId => {
    const isCurrentUser = userId === currentUserId;
    const user = presentUsers.find(u => u.user_id === userId);

    // For current user, use currentUsername prop if not in presentUsers
    let username = user?.username;
    if (!username && isCurrentUser) {
      username = currentUsername || 'Me';
    } else if (!username) {
      username = 'Unknown User';
    }

    return {
      user_id: userId,
      username: username,
      isCurrentUser: isCurrentUser,
    };
  }).sort((a, b) => {
    // Current user first, then alphabetically
    if (a.isCurrentUser) return -1;
    if (b.isCurrentUser) return 1;
    return a.username.localeCompare(b.username);
  });

  // Debug logging
  console.log('[AnnotationToolbar] Total annotations:', annotations.length);
  if (annotations.length > 0) {
    console.log('[AnnotationToolbar] First annotation:', annotations[0]);
  }
  console.log('[AnnotationToolbar] Users with annotations:', usersWithAnnotations);
  console.log('[AnnotationToolbar] Current user ID:', currentUserId);
  console.log('[AnnotationToolbar] Present users:', presentUsers);
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

      {/* User Visibility Toggle - Always show */}
      <View style={styles.visibilityContainer}>
        <TouchableOpacity
          style={styles.visibilityButton}
          onPress={() => onToggleDropdown(!showUserVisibilityDropdown)}
        >
          <FontAwesomeIcon icon={faEye} size={16} color={COLORS.darkBrown} />
          <Text style={styles.visibilityButtonText}>Users</Text>
          <FontAwesomeIcon
            icon={showUserVisibilityDropdown ? faChevronUp : faChevronDown}
            size={12}
            color={COLORS.darkBrown}
          />
        </TouchableOpacity>

        {showUserVisibilityDropdown && (
          <View style={styles.visibilityDropdown}>
            {usersWithAnnotations.length > 0 ? (
              usersWithAnnotations.map((user) => (
                <View key={user.user_id} style={styles.visibilityRow}>
                  <Text style={styles.visibilityUsername}>
                    {user.username}{user.isCurrentUser ? ' (Me)' : ''}
                  </Text>
                  <Switch
                    value={!hiddenAnnotationUsers.has(user.user_id)}
                    onValueChange={() => onToggleUserVisibility(user.user_id)}
                    trackColor={{ false: COLORS.lightBrown, true: COLORS.darkBrown }}
                    thumbColor={COLORS.beige}
                  />
                </View>
              ))
            ) : (
              <View style={styles.visibilityRow}>
                <Text style={styles.visibilityEmptyText}>No annotations yet</Text>
              </View>
            )}
          </View>
        )}
      </View>
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
  visibilityContainer: {
    position: 'relative',
    zIndex: 9999,
  },
  visibilityButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.beige,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  visibilityButtonText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 14,
    color: COLORS.darkBrown,
  },
  visibilityDropdown: {
    position: 'absolute',
    top: 44,
    right: 0,
    backgroundColor: COLORS.beige,
    borderRadius: 8,
    paddingVertical: 8,
    minWidth: 200,
    zIndex: 9999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 10,
  },
  visibilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 12,
  },
  visibilityUsername: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 14,
    color: COLORS.darkBrown,
    flex: 1,
  },
  visibilityEmptyText: {
    fontFamily: 'Afacad_400Regular',
    fontSize: 14,
    color: COLORS.lightBrown,
    fontStyle: 'italic',
  },
});
