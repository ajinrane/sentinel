const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

export const API_BASE = isDev ? 'http://localhost:8111' : '';
export const WS_URL = isDev
  ? 'ws://localhost:8111/ws/feed'
  : `wss://${window.location.host}/ws/feed`;
