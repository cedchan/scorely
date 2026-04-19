import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateUsername } from '../config';

const USER_ID_KEY = '@scorely_user_id';
const USERNAME_KEY = '@scorely_username';

/**
 * Generate a stable user ID based on device/browser session
 */
const generateUserId = () => {
  return `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Get or create a stable user ID
 */
export const getUserId = async () => {
  try {
    let userId = await AsyncStorage.getItem(USER_ID_KEY);
    if (!userId) {
      userId = generateUserId();
      await AsyncStorage.setItem(USER_ID_KEY, userId);
    }
    return userId;
  } catch (error) {
    console.error('Error getting user ID:', error);
    return generateUserId();
  }
};

/**
 * Get or create a username
 */
export const getUsername = async () => {
  try {
    let username = await AsyncStorage.getItem(USERNAME_KEY);
    if (!username) {
      username = generateUsername();
      await AsyncStorage.setItem(USERNAME_KEY, username);
    }
    return username;
  } catch (error) {
    console.error('Error getting username:', error);
    return generateUsername();
  }
};

/**
 * Update the username (user_id stays the same)
 */
export const setUsername = async (newUsername) => {
  try {
    await AsyncStorage.setItem(USERNAME_KEY, newUsername);
    return true;
  } catch (error) {
    console.error('Error setting username:', error);
    return false;
  }
};

/**
 * Initialize user identity and return both user_id and username
 */
export const initializeUserIdentity = async () => {
  const [userId, username] = await Promise.all([
    getUserId(),
    getUsername(),
  ]);
  return { userId, username };
};
