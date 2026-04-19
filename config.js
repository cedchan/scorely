/**
 * Scorely Application Configuration
 *
 * Edit these settings to customize app behavior.
 */

export const config = {
  // ===== Nod Detection Settings =====
  nodDetection: {
    // Show debug overlay on screen (Phase, Delta, Baseline)
    showDebug: false,

    // Show live camera preview
    showCameraPreview: true,

    // Movement thresholds (0-1 scale, where larger = more movement required)
    downThreshold: 0.01,  // How much you need to nod down to trigger
    upThreshold: 0.004,   // How much you need to return up to complete the nod

    // Cooldown period in milliseconds between page turns
    cooldownMs: 1200,

    // Baseline smoothing factor (0-1, higher = slower adaptation to head position changes)
    baselineSmoothing: 0.9,
  },

  // ===== Add more settings here as needed =====
};

// ===== Username Generation =====
export const ADJECTIVES = [
  'Swift', 'Gentle', 'Brave', 'Clever', 'Bold',
  'Bright', 'Quick', 'Calm', 'Eager', 'Happy',
  'Jolly', 'Kind', 'Lively', 'Noble', 'Proud',
  'Quiet', 'Royal', 'Sharp', 'Warm', 'Wise',
  'Agile', 'Cosmic', 'Dynamic', 'Epic', 'Flying',
  'Golden', 'Hidden', 'Ionic', 'Jazzy', 'Lucky',
  'Mystic', 'Nimble', 'Stellar', 'Turbo', 'Vivid'
];

export const NOUNS = [
  'Tiger', 'Eagle', 'Lion', 'Wolf', 'Bear',
  'Falcon', 'Hawk', 'Dragon', 'Phoenix', 'Panda',
  'Dolphin', 'Owl', 'Fox', 'Raven', 'Jaguar',
  'Lynx', 'Orca', 'Panther', 'Sparrow', 'Swan',
  'Comet', 'Nova', 'Star', 'Moon', 'Sun',
  'Meteor', 'Aurora', 'Galaxy', 'Nebula', 'Quasar',
  'Thunder', 'Storm', 'Blaze', 'Wave', 'Wind'
];

// Generate a random username
export const generateUsername = () => {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const number = Math.floor(Math.random() * 1000);
  return `${adjective}${noun}${number}`;
};
