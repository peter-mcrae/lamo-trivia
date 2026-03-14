import { useEffect, useRef, useState, useCallback } from 'react';
import type { ClientMessage, ServerMessage } from '@lamo-trivia/shared';

interface UseWebSocketOptions {
  gameId: string;
  onMessage?: (message: ServerMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

const MAX_RECONNECT_DELAY = 10_000;

function buildWsUrl(gameId: string): string {
  const apiUrl = import.meta.env.VITE_API_URL;
  if (apiUrl) {
    const url = new URL(apiUrl);
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${url.host}/ws/game/${gameId}`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/game/${gameId}`;
}

export function useWebSocket({ gameId, onMessage, onOpen, onClose }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  // Use refs for callbacks to avoid stale closures
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const connect = useCallback(() => {
    if (unmountedRef.current) return;

    const ws = new WebSocket(buildWsUrl(gameId));
    wsRef.current = ws;

    ws.onopen = () => {
      if (wsRef.current === ws) {
        setConnected(true);
        reconnectAttemptRef.current = 0;
      }
      onOpenRef.current?.();
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as ServerMessage;
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
  }, [gameId]);

  useEffect(() => {
    unmountedRef.current = false;
    reconnectAttemptRef.current = 0;
    setConnected(false);

    connect();

    return () => {
      unmountedRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  const send = useCallback((message: ClientMessage): boolean => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
      return true;
    }
    return false;
  }, []);

  return { connected, send };
}
