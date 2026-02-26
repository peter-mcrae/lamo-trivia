import { useEffect, useRef, useState, useCallback } from 'react';
import type { GroupClientMessage, GroupServerMessage } from '@lamo-trivia/shared';

interface UseGroupWebSocketOptions {
  groupId: string;
  onMessage?: (message: GroupServerMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

export function useGroupWebSocket({ groupId, onMessage, onOpen, onClose }: UseGroupWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL;
    let wsUrl: string;
    if (apiUrl) {
      const url = new URL(apiUrl);
      const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${protocol}//${url.host}/ws/group/${groupId}`;
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${protocol}//${window.location.host}/ws/group/${groupId}`;
    }
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setConnected(true);
      onOpen?.();
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as GroupServerMessage;
        onMessage?.(message);
      } catch {
        console.error('Failed to parse group WebSocket message');
      }
    };

    ws.onclose = () => {
      setConnected(false);
      onClose?.();
    };

    wsRef.current = ws;

    return () => {
      ws.close();
    };
  }, [groupId]);

  const send = useCallback((message: GroupClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  return { connected, send };
}
