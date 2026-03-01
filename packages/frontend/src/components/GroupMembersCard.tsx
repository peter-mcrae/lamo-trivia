import { useEffect, useRef, useState, useCallback } from 'react';
import type { GroupServerMessage } from '@lamo-trivia/shared';
import { useGroupWebSocket } from '@/hooks/useGroupWebSocket';
import { useGroupState } from '@/hooks/useGroupState';
import { useGroups } from '@/hooks/useGroups';
import { useUsername } from '@/hooks/useUsername';

interface GroupMembersCardProps {
  groupId: string;
  gameId: string;
  gameName: string;
  gamePlayerUsernames: string[];
}

export function GroupMembersCard({ groupId, gameId, gameName, gamePlayerUsernames }: GroupMembersCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [inviteSent, setInviteSent] = useState(false);
  const { getMemberId } = useGroups();
  const { username } = useUsername();
  const { groupState, handleMessage } = useGroupState();
  const joinedRef = useRef(false);

  const onMessage = useCallback(
    (message: GroupServerMessage) => {
      if (message.type === 'join_confirmed') return;
      if (message.type === 'error') return;
      handleMessage(message);
    },
    [handleMessage],
  );

  const { connected, send } = useGroupWebSocket({
    groupId,
    onMessage,
  });

  // Join group once connected
  useEffect(() => {
    if (connected && username && !joinedRef.current) {
      joinedRef.current = true;
      const memberId = getMemberId(groupId);
      send({
        type: 'join_group',
        username,
        ...(memberId ? { memberId } : {}),
      });
    }
  }, [connected, username, send, groupId, getMemberId]);

  if (!groupState) return null;

  const gamePlayersLower = new Set(gamePlayerUsernames.map((u) => u.toLowerCase()));
  const availableMembers = groupState.members.filter(
    (m) => m.online && !gamePlayersLower.has(m.username.toLowerCase()),
  );

  const handleInvite = () => {
    send({ type: 'invite_to_game', gameId, gameName });
    setInviteSent(true);
    setTimeout(() => setInviteSent(false), 10000);
  };

  return (
    <div className="mb-4 bg-lamo-bg border border-lamo-border rounded-xl overflow-hidden">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-white/50 transition-colors"
      >
        <span className="text-xs font-semibold text-lamo-dark">
          Group Online ({availableMembers.length})
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className={`w-3.5 h-3.5 text-lamo-gray-muted transition-transform ${collapsed ? '' : 'rotate-180'}`}
        >
          <path
            fillRule="evenodd"
            d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {!collapsed && (
        <div className="px-4 pb-3">
          {availableMembers.length > 0 ? (
            <>
              <div className="flex flex-wrap gap-1.5 mb-2.5">
                {availableMembers.map((m) => (
                  <span
                    key={m.memberId ?? m.username}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-white rounded-full text-xs"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                    <span className="font-medium text-lamo-dark">{m.username}</span>
                  </span>
                ))}
              </div>
              <button
                onClick={handleInvite}
                disabled={inviteSent}
                className="text-xs px-3 py-1.5 rounded-full bg-lamo-blue/10 text-lamo-blue font-medium hover:bg-lamo-blue/20 transition-colors disabled:opacity-50"
              >
                {inviteSent ? 'Invite Sent!' : 'Invite to Game'}
              </button>
            </>
          ) : (
            <p className="text-xs text-lamo-gray-muted">No other group members online.</p>
          )}
        </div>
      )}
    </div>
  );
}
