import { useEffect, useRef, useState, useCallback } from 'react';
import type { ClientMessage, ServerMessage } from '@lamo-trivia/shared';

interface UseWebSocketOptions {
  gameId: string;
  onMessage?: (message: ServerMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

export function useWebSocket({ gameId, onMessage, onOpen, onClose }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    setConnected(false);

    const apiUrl = import.meta.env.VITE_API_URL;
    let wsUrl: string;
    if (apiUrl) {
      // Production: connect to the Worker directly
      const url = new URL(apiUrl);
      const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${protocol}//${url.host}/ws/game/${gameId}`;
    } else {
      // Dev: use same host (Vite proxy handles it)
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${protocol}//${window.location.host}/ws/game/${gameId}`;
    }
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (wsRef.current === ws) setConnected(true);
      onOpen?.();
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as ServerMessage;
        onMessage?.(message);
      } catch {
        console.error('Failed to parse WebSocket message');
      }
    };

    ws.onclose = () => {
      if (wsRef.current === ws) setConnected(false);
      onClose?.();
    };

    return () => {
      ws.close();
    };
  }, [gameId]);

  const send = useCallback((message: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  return { connected, send };
}
