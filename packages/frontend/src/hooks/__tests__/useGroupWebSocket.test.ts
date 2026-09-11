import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { AUTH_TOKEN_KEY } from '@/lib/api';
import { useGroupWebSocket } from '../useGroupWebSocket';

// Mock WebSocket — same shape as hooks/__tests__/useWebSocket.test.ts, the
// established pattern in this codebase for driving useXWebSocket hooks
// without a real socket.
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

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

describe('useGroupWebSocket — auth token wiring', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function latestWs(): MockWebSocket {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }

  it('appends ?token= from AUTH_TOKEN_KEY, URL-encoded', () => {
    const token = 'tok en&val=1+more/stuff';
    localStorage.setItem(AUTH_TOKEN_KEY, token);

    renderHook(() => useGroupWebSocket({ groupId: 'GRP-1' }));

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(latestWs().url).toContain('/ws/group/GRP-1');
    expect(latestWs().url).toContain(`?token=${encodeURIComponent(token)}`);
  });

  it('[control] produces a clean URL with no dangling ? when no token is stored', () => {
    // localStorage holds no AUTH_TOKEN_KEY entry at all.
    renderHook(() => useGroupWebSocket({ groupId: 'GRP-1' }));

    expect(latestWs().url).toContain('/ws/group/GRP-1');
    expect(latestWs().url).not.toContain('?');
  });

  it('re-reads the token on reconnect rather than capturing it once at mount', () => {
    vi.useFakeTimers();
    // No token at mount.
    renderHook(() => useGroupWebSocket({ groupId: 'GRP-1' }));

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(latestWs().url).not.toContain('?token=');

    act(() => latestWs().simulateOpen());

    // The session becomes available only after the initial connection —
    // e.g. the user finishes signing in while already in the group.
    const freshToken = 'fresh-session-token';
    localStorage.setItem(AUTH_TOKEN_KEY, freshToken);

    // Drop the connection; the hook auto-reconnects with backoff (1000ms on
    // the first attempt).
    act(() => latestWs().simulateClose());
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(MockWebSocket.instances).toHaveLength(2);
    expect(latestWs().url).toContain(`?token=${encodeURIComponent(freshToken)}`);
  });
});
