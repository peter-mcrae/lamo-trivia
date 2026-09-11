import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { GroupClientMessage, GroupServerMessage, User } from '@lamo-trivia/shared';

// --- Mocks ---

let mockUser: User | null = null;
let mockAuthLoading = false;
vi.mock('@/contexts/AuthContext', () => ({
  useAuthContext: () => ({ user: mockUser, loading: mockAuthLoading }),
}));

let wsSendSpy: ReturnType<typeof vi.fn>;
let wsOnMessage: ((msg: GroupServerMessage) => void) | undefined;
let wsConnected: boolean;
vi.mock('@/hooks/useGroupWebSocket', () => ({
  useGroupWebSocket: ({ onMessage }: { onMessage?: (msg: GroupServerMessage) => void }) => {
    wsOnMessage = onMessage;
    return { connected: wsConnected, send: wsSendSpy };
  },
}));

const linkGroupMemberMock = vi.fn();
vi.mock('@/lib/api', () => ({
  api: {
    linkGroupMember: (groupId: string, memberId?: string) => linkGroupMemberMock(groupId, memberId),
    getGroupHuntHistory: vi.fn(() => Promise.resolve({ hunts: [] })),
    getGroup: vi.fn(() =>
      Promise.resolve({ id: 'GRP-1', name: 'Test Group', createdAt: 0, memberCount: 1 }),
    ),
  },
}));

import GroupLobby from '../GroupLobby';

// --- Helpers ---

function renderGroupLobby() {
  return render(
    <MemoryRouter initialEntries={['/groups/GRP-1']}>
      <Routes>
        <Route path="/groups/:groupId" element={<GroupLobby />} />
      </Routes>
    </MemoryRouter>,
  );
}

function sentMessages(): GroupClientMessage[] {
  return wsSendSpy.mock.calls.map((c) => c[0] as GroupClientMessage);
}

function serverMessage(msg: unknown) {
  act(() => {
    wsOnMessage?.(msg as GroupServerMessage);
  });
}

const signedInUser: User = { userId: 'u-1', email: 'player@example.com', credits: 0, createdAt: 0 };

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('lamo-trivia-username', 'TestPlayer');
  wsSendSpy = vi.fn();
  wsConnected = true;
  wsOnMessage = undefined;
  mockUser = null;
  mockAuthLoading = false;
  linkGroupMemberMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

// --- Tests ---

describe('GroupLobby — pre-join membership link gating', () => {
  it('joins after LINK_CHECK_TIMEOUT_MS when the link request never settles, even if the effect re-runs first', () => {
    vi.useFakeTimers();
    mockUser = signedInUser;
    linkGroupMemberMock.mockReturnValue(new Promise(() => {})); // never settles

    renderGroupLobby();

    expect(sentMessages()).not.toContainEqual(expect.objectContaining({ type: 'join_group' }));

    // Force the link-check effect's dependencies to change identity (getMemberId
    // is recreated whenever `groups` state updates) by letting groupState
    // arrive, which triggers the "save group to localStorage" effect's
    // addGroup call. If the pending timeout were implemented via an effect
    // cleanup instead of a plain ref, this re-run would cancel it — and the
    // linkRef guard would block scheduling a replacement — hanging the join
    // forever. See GroupLobby.tsx's comment on why the timer lives in a ref.
    serverMessage({
      type: 'group_state',
      state: { id: 'GRP-1', name: 'Test Group', createdAt: 0, members: [], games: [] },
    });

    expect(sentMessages()).not.toContainEqual(expect.objectContaining({ type: 'join_group' }));

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(sentMessages()).toContainEqual(
      expect.objectContaining({ type: 'join_group', username: 'TestPlayer' }),
    );
  });

  it('[control] a link request that fails fast does not block joining', async () => {
    mockUser = signedInUser;
    linkGroupMemberMock.mockRejectedValueOnce(new Error('not a member yet'));

    renderGroupLobby();

    await waitFor(() => {
      expect(sentMessages()).toContainEqual(
        expect.objectContaining({ type: 'join_group', username: 'TestPlayer' }),
      );
    });
  });

  it('a successful link proceeds normally and its memberId is used to join', async () => {
    mockUser = signedInUser;
    linkGroupMemberMock.mockResolvedValueOnce({
      memberId: 'm-99',
      username: 'TestPlayer',
      linked: true,
    });

    renderGroupLobby();

    await waitFor(() => {
      expect(sentMessages()).toContainEqual(
        expect.objectContaining({ type: 'join_group', username: 'TestPlayer', memberId: 'm-99' }),
      );
    });
  });
});
