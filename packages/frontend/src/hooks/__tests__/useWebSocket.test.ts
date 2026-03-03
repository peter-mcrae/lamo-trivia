import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebSocket } from '../useWebSocket';

// Mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  });
  send = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  simulateMessage(data: object) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

describe('useWebSocket', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function latestWs(): MockWebSocket {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }

  it('creates WebSocket with correct URL for gameId', () => {
    renderHook(() => useWebSocket({ gameId: 'ABC-1234' }));

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(latestWs().url).toContain('/ws/game/ABC-1234');
  });

  it('starts disconnected, then connected on open', () => {
    const { result } = renderHook(() => useWebSocket({ gameId: 'ABC-1234' }));

    expect(result.current.connected).toBe(false);

    act(() => latestWs().simulateOpen());

    expect(result.current.connected).toBe(true);
  });

  it('sets connected to false on close', () => {
    const { result } = renderHook(() => useWebSocket({ gameId: 'ABC-1234' }));

    act(() => latestWs().simulateOpen());
    expect(result.current.connected).toBe(true);

    act(() => latestWs().simulateClose());
    expect(result.current.connected).toBe(false);
  });

  it('calls onMessage with parsed message data', () => {
    const onMessage = vi.fn();
    renderHook(() => useWebSocket({ gameId: 'ABC-1234', onMessage }));

    act(() => latestWs().simulateOpen());
    act(() => latestWs().simulateMessage({ type: 'game_state', state: {} }));

    expect(onMessage).toHaveBeenCalledWith({ type: 'game_state', state: {} });
  });

  it('calls onOpen and onClose callbacks', () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    renderHook(() => useWebSocket({ gameId: 'ABC-1234', onOpen, onClose }));

    act(() => latestWs().simulateOpen());
    expect(onOpen).toHaveBeenCalledOnce();

    act(() => latestWs().simulateClose());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('send() sends JSON when connected', () => {
    const { result } = renderHook(() => useWebSocket({ gameId: 'ABC-1234' }));

    act(() => latestWs().simulateOpen());

    act(() => {
      result.current.send({ type: 'join_game', gameId: 'ABC-1234', username: 'Player1' });
    });

    expect(latestWs().send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'join_game', gameId: 'ABC-1234', username: 'Player1' }),
    );
  });

  it('send() does nothing when not connected', () => {
    const { result } = renderHook(() => useWebSocket({ gameId: 'ABC-1234' }));

    act(() => {
      result.current.send({ type: 'join_game', gameId: 'ABC-1234', username: 'Player1' });
    });

    expect(latestWs().send).not.toHaveBeenCalled();
  });

  it('closes old WebSocket and creates new one when gameId changes', () => {
    const { rerender } = renderHook(
      ({ gameId }) => useWebSocket({ gameId }),
      { initialProps: { gameId: 'GAME-1' } },
    );

    const firstWs = latestWs();
    act(() => firstWs.simulateOpen());

    rerender({ gameId: 'GAME-2' });

    expect(firstWs.close).toHaveBeenCalled();
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(latestWs().url).toContain('/ws/game/GAME-2');
  });

  it('old WS onclose does not clobber new WS connected state (race condition)', () => {
    const { result, rerender } = renderHook(
      ({ gameId }) => useWebSocket({ gameId }),
      { initialProps: { gameId: 'GAME-1' } },
    );

    const firstWs = latestWs();
    // Prevent close() from firing onclose synchronously so we can simulate async
    firstWs.close = vi.fn(() => { firstWs.readyState = MockWebSocket.CLOSED; });

    act(() => firstWs.simulateOpen());
    expect(result.current.connected).toBe(true);

    // Navigate to new game — cleanup closes old WS (but onclose doesn't fire yet)
    rerender({ gameId: 'GAME-2' });
    const secondWs = latestWs();

    // New WS connects first
    act(() => secondWs.simulateOpen());
    expect(result.current.connected).toBe(true);

    // Old WS onclose fires late (async) — should NOT clobber connected state
    act(() => firstWs.simulateClose());
    expect(result.current.connected).toBe(true);
  });

  it('closes WebSocket on unmount', () => {
    const { unmount } = renderHook(() => useWebSocket({ gameId: 'ABC-1234' }));

    const ws = latestWs();
    unmount();

    expect(ws.close).toHaveBeenCalled();
  });
});
