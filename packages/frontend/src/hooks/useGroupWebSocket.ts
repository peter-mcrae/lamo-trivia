import { useEffect, useRef, useState, useCallback } from 'react';
import type { GroupClientMessage, GroupServerMessage } from '@lamo-trivia/shared';

interface UseGroupWebSocketOptions {
  groupId: string;
  onMessage?: (message: GroupServerMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

const MAX_RECONNECT_DELAY = 10_000;

function buildWsUrl(groupId: string): string {
  const apiUrl = import.meta.env.VITE_API_URL;
  if (apiUrl) {
    const url = new URL(apiUrl);
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${url.host}/ws/group/${groupId}`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/group/${groupId}`;
}

export function useGroupWebSocket({ groupId, onMessage, onOpen, onClose }: UseGroupWebSocketOptions) {
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

    const ws = new WebSocket(buildWsUrl(groupId));
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
        const message = JSON.parse(event.data) as GroupServerMessage;
        onMessageRef.current?.(message);
      } catch {
        console.error('Failed to parse group WebSocket message');
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
  }, [groupId]);

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

  const send = useCallback((message: GroupClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  return { connected, send };
}
