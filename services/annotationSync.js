/**
 * Annotation Sync Service
 *
 * Handles WebSocket connection for real-time annotation synchronization.
 * Manages connection state, message sending/receiving, and Yjs integration.
 */

import { Platform } from 'react-native';

class AnnotationSyncService {
  constructor() {
    this.ws = null;
    this.jobId = null;
    this.apiBaseUrl = null;
    this.userId = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 2000;

    // Event listeners
    this.listeners = {
      connected: [],
      disconnected: [],
      annotation_added: [],
      annotation_updated: [],
      annotation_deleted: [],
      sync_response: [],
      error: [],
    };
  }

  /**
   * Connect to WebSocket server
   */
  connect(apiBaseUrl, jobId, userId) {
    if (this.ws && this.isConnected) {
      console.warn('Already connected to annotation sync');
      return;
    }

    this.jobId = jobId;
    this.apiBaseUrl = apiBaseUrl;
    this.userId = userId;

    // Construct WebSocket URL
    const wsProtocol = apiBaseUrl.startsWith('https') ? 'wss' : 'ws';
    const wsUrl = `${wsProtocol}://${apiBaseUrl.replace(/^https?:\/\//, '')}/ws/annotations/${jobId}`;

    console.log('Connecting to annotation sync:', wsUrl);

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('Annotation sync connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this._notifyListeners('connected', {});
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this._handleMessage(data);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this._notifyListeners('error', { error: error.message || 'WebSocket error' });
      };

      this.ws.onclose = () => {
        console.log('Annotation sync disconnected');
        this.isConnected = false;
        this._notifyListeners('disconnected', {});

        // Attempt reconnect
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          console.log(`Reconnecting... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

          setTimeout(() => {
            this.connect(this.apiBaseUrl, this.jobId, this.userId);
          }, this.reconnectDelay);
        }
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      this._notifyListeners('error', { error: error.message || 'Connection failed' });
    }
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
    this.reconnectAttempts = this.maxReconnectAttempts; // Prevent auto-reconnect
  }

  /**
   * Send annotation_added message
   */
  addAnnotation(annotation) {
    if (!this.isConnected || !this.ws) {
      console.warn('Not connected to annotation sync');
      return;
    }

    const message = {
      type: 'annotation_added',
      annotation: {
        ...annotation,
        job_id: this.jobId,
        user_id: this.userId,
      },
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Send annotation_updated message
   */
  updateAnnotation(annotation) {
    if (!this.isConnected || !this.ws) {
      console.warn('Not connected to annotation sync');
      return;
    }

    const message = {
      type: 'annotation_updated',
      annotation: {
        ...annotation,
        job_id: this.jobId,
        user_id: this.userId,
      },
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Send annotation_deleted message
   */
  deleteAnnotation(annotationId) {
    if (!this.isConnected || !this.ws) {
      console.warn('Not connected to annotation sync');
      return;
    }

    const message = {
      type: 'annotation_deleted',
      annotation_id: annotationId,
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Request full sync
   */
  requestSync() {
    if (!this.isConnected || !this.ws) {
      console.warn('Not connected to annotation sync');
      return;
    }

    const message = {
      type: 'sync_request',
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Add event listener
   */
  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
  }

  /**
   * Remove event listener
   */
  off(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter((cb) => cb !== callback);
    }
  }

  /**
   * Handle incoming WebSocket message
   */
  _handleMessage(data) {
    const { type } = data;

    switch (type) {
      case 'sync_response':
        this._notifyListeners('sync_response', {
          annotations: data.annotations || [],
        });
        break;

      case 'annotation_added':
        this._notifyListeners('annotation_added', {
          annotation: data.annotation,
        });
        break;

      case 'annotation_updated':
        this._notifyListeners('annotation_updated', {
          annotation: data.annotation,
        });
        break;

      case 'annotation_deleted':
        this._notifyListeners('annotation_deleted', {
          annotationId: data.annotation_id,
        });
        break;

      case 'error':
        this._notifyListeners('error', {
          error: data.message || 'Unknown error',
        });
        break;

      case 'yjs_state_vector':
        // For future Yjs integration
        console.log('Received Yjs state vector');
        break;

      case 'yjs_update':
        // For future Yjs integration
        console.log('Received Yjs update');
        break;

      default:
        console.warn('Unknown message type:', type);
    }
  }

  /**
   * Notify all listeners for an event
   */
  _notifyListeners(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach((callback) => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in ${event} listener:`, error);
        }
      });
    }
  }

  /**
   * Generate a unique user ID
   */
  static generateUserId() {
    return `user-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Global singleton instance
const annotationSyncService = new AnnotationSyncService();

export default annotationSyncService;
