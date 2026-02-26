import { useState, useCallback } from 'react';
import type { GroupState, GroupServerMessage } from '@lamo-trivia/shared';

export function useGroupState() {
  const [groupState, setGroupState] = useState<GroupState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleMessage = useCallback((message: GroupServerMessage) => {
    switch (message.type) {
      case 'group_state':
        setGroupState(message.state);
        break;

      case 'member_joined':
        setGroupState((prev) => {
          if (!prev) return prev;
          return { ...prev, members: [...prev.members, message.member] };
        });
        break;

      case 'member_left':
        setGroupState((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            members: prev.members.filter((m) => m.username !== message.username),
          };
        });
        break;

      case 'member_online':
        setGroupState((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            members: prev.members.map((m) =>
              m.username === message.username ? { ...m, online: true } : m,
            ),
          };
        });
        break;

      case 'member_offline':
        setGroupState((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            members: prev.members.map((m) =>
              m.username === message.username ? { ...m, online: false } : m,
            ),
          };
        });
        break;

      case 'game_created':
        setGroupState((prev) => {
          if (!prev) return prev;
          return { ...prev, games: [...prev.games, message.game] };
        });
        break;

      case 'game_updated':
        setGroupState((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            games: prev.games.map((g) =>
              g.gameId === message.game.gameId ? message.game : g,
            ),
          };
        });
        break;

      case 'game_removed':
        setGroupState((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            games: prev.games.filter((g) => g.gameId !== message.gameId),
          };
        });
        break;

      case 'error':
        setError(message.message);
        break;
    }
  }, []);

  return { groupState, error, handleMessage };
}
