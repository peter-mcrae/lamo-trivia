import { useEffect, useRef, useState, useCallback } from 'react';
import type { HuntClientMessage, HuntServerMessage } from '@lamo-trivia/shared';
import { AUTH_TOKEN_KEY } from '@/lib/api';

interface UseHuntWebSocketOptions {
  huntId: string;
  onMessage?: (message: HuntServerMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

function buildWsUrl(huntId: string): string {
  const apiUrl = import.meta.env.VITE_API_URL;
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  if (apiUrl) {
    const url = new URL(apiUrl);
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${url.host}/ws/hunt/${huntId}${query}`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/hunt/${huntId}${query}`;
}

const MAX_RECONNECT_DELAY = 10_000;
// Heartbeat keeps the connection verified and triggers the server's state
// resync on each ping. A ping that goes unanswered by the next tick means the
// socket is a zombie (TCP silently dropped while backgrounded) — close it so
// the reconnect logic kicks in instead of sending messages into the void.
const HEARTBEAT_INTERVAL_MS = 15_000;

export function useHuntWebSocket({ huntId, onMessage, onOpen, onClose }: UseHuntWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  const pingOutstandingRef = useRef(false);

  // Use refs for callbacks to avoid stale closures
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const connect = useCallback(() => {
    if (unmountedRef.current) return;

    const ws = new WebSocket(buildWsUrl(huntId));
    wsRef.current = ws;

    ws.onopen = () => {
      if (wsRef.current === ws) {
        setConnected(true);
        reconnectAttemptRef.current = 0;
        pingOutstandingRef.current = false;
      }
      onOpenRef.current?.();
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as HuntServerMessage;
        if (message.type === 'pong') {
          pingOutstandingRef.current = false;
        }
        onMessageRef.current?.(message);
      } catch {
        console.error('Failed to parse WebSocket message');
      }
    };

    ws.onclose = () => {
      if (wsRef.current === ws) {
        setConnected(false);
      }
      onCloseRef.current?.();

      // Auto-reconnect with exponential backoff
      if (!unmountedRef.current && wsRef.current === ws) {
        const attempt = reconnectAttemptRef.current++;
        const delay = Math.min(1000 * 2 ** attempt, MAX_RECONNECT_DELAY);
        reconnectTimerRef.current = setTimeout(connect, delay);
      }
    };
  }, [huntId]);

  useEffect(() => {
    unmountedRef.current = false;
    reconnectAttemptRef.current = 0;
    setConnected(false);

    connect();

    const heartbeat = setInterval(() => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (pingOutstandingRef.current) {
        // No pong since the last ping — zombie socket, force a reconnect
        ws.close();
        return;
      }
      pingOutstandingRef.current = true;
      ws.send(JSON.stringify({ type: 'ping' }));
    }, HEARTBEAT_INTERVAL_MS);

    // Returning from a backgrounded tab (e.g. after using the camera) is
    // exactly when sockets die silently — probe immediately rather than
    // waiting for the next heartbeat or backoff timer
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible' || unmountedRef.current) return;
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        pingOutstandingRef.current = true;
        ws.send(JSON.stringify({ type: 'ping' }));
      } else if (ws && ws.readyState !== WebSocket.CONNECTING) {
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        reconnectAttemptRef.current = 0;
        connect();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      unmountedRef.current = true;
      clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [huntId]); // eslint-disable-line react-hooks/exhaustive-deps -- connect is stable per huntId

  const send = useCallback((message: HuntClientMessage): boolean => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
      return true;
    }
    return false;
  }, []);

  return { connected, send };
}
