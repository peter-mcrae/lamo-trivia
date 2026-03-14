import { useState, useCallback } from 'react';
import type {
  ClientHuntState, HuntItem, HuntItemProgress, HuntPlayerProgress,
  HuntResults, HuntAppeal, HuntServerMessage, Player, HuntTeamSummary,
} from '@lamo-trivia/shared';

export function useHuntState() {
  const [huntState, setHuntState] = useState<ClientHuntState | null>(null);
  const [items, setItems] = useState<HuntItem[]>([]);
  const [myProgress, setMyProgress] = useState<HuntPlayerProgress | null>(null);
  const [results, setResults] = useState<HuntResults | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [appeals, setAppeals] = useState<HuntAppeal[]>([]);
  const [verifyingItems, setVerifyingItems] = useState<Set<string>>(new Set());
  const [timeWarning, setTimeWarning] = useState<number | null>(null);
  const [allTeams, setAllTeams] = useState<HuntTeamSummary[] | null>(null);

  const handleMessage = useCallback((message: HuntServerMessage) => {
    switch (message.type) {
      case 'hunt_state':
        setHuntState(message.state);
        setMyProgress(message.state.myProgress);
        if (message.state.allTeams) {
          setAllTeams(message.state.allTeams);
        }
        break;

      case 'player_joined':
        setHuntState((prev) => {
          if (!prev) return prev;
          return { ...prev, players: [...prev.players, message.player] };
        });
        break;

      case 'player_left':
        setHuntState((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            players: prev.players.filter((p: Player) => p.id !== message.playerId),
            ...(message.newHostId ? { hostId: message.newHostId } : {}),
          };
        });
        break;

      case 'host_changed':
        setHuntState((prev) => {
          if (!prev) return prev;
          return { ...prev, hostId: message.hostId };
        });
        break;

      case 'hunt_starting':
        setCountdown(message.countdown);
        setHuntState((prev) => {
          if (!prev) return prev;
          return { ...prev, phase: 'starting' };
        });
        break;

      case 'hunt_started':
        setItems(message.items);
        setHuntState((prev) => {
          if (!prev) return prev;
          return { ...prev, phase: 'playing', endsAt: message.endsAt };
        });
        break;

      case 'clue_revealed':
        setMyProgress((prev) => {
          if (!prev) return prev;
          const itemProgress = prev.items[message.itemId];
          if (!itemProgress) return prev;
          return {
            ...prev,
            totalScore: message.newScore,
            items: {
              ...prev.items,
              [message.itemId]: {
                ...itemProgress,
                cluesRevealed: [...itemProgress.cluesRevealed, message.clueId],
              },
            },
          };
        });
        break;

      case 'photo_verifying':
        setVerifyingItems((prev) => new Set(prev).add(message.itemId));
        break;

      case 'photo_accepted':
        setVerifyingItems((prev) => {
          const next = new Set(prev);
          next.delete(message.itemId);
          return next;
        });
        setMyProgress((prev) => {
          if (!prev) return prev;
          const itemProgress = prev.items[message.itemId];
          if (!itemProgress) return prev;
          return {
            ...prev,
            totalScore: message.newScore,
            items: {
              ...prev.items,
              [message.itemId]: { ...itemProgress, status: 'found' as const },
            },
          };
        });
        break;

      case 'photo_rejected':
        setVerifyingItems((prev) => {
          const next = new Set(prev);
          next.delete(message.itemId);
          return next;
        });
        setMyProgress((prev) => {
          if (!prev) return prev;
          const itemProgress = prev.items[message.itemId];
          if (!itemProgress) return prev;
          return {
            ...prev,
            items: {
              ...prev.items,
              [message.itemId]: { ...itemProgress, status: 'searching' as const },
            },
          };
        });
        break;

      case 'appeal_submitted':
        setMyProgress((prev) => {
          if (!prev) return prev;
          const itemProgress = prev.items[message.itemId];
          if (!itemProgress) return prev;
          return {
            ...prev,
            items: {
              ...prev.items,
              [message.itemId]: { ...itemProgress, status: 'rejected' as const },
            },
          };
        });
        break;

      case 'appeal_received':
        setAppeals((prev) => [...prev, message.appeal]);
        break;

      case 'appeal_approved':
        setMyProgress((prev) => {
          if (!prev) return prev;
          const itemProgress = prev.items[message.itemId];
          if (!itemProgress) return prev;
          return {
            ...prev,
            totalScore: message.newScore,
            items: {
              ...prev.items,
              [message.itemId]: { ...itemProgress, status: 'found' as const },
            },
          };
        });
        break;

      case 'appeal_rejected':
        setMyProgress((prev) => {
          if (!prev) return prev;
          const itemProgress = prev.items[message.itemId];
          if (!itemProgress) return prev;
          return {
            ...prev,
            items: {
              ...prev.items,
              [message.itemId]: { ...itemProgress, status: 'rejected' as const },
            },
          };
        });
        break;

      case 'hunt_finished':
        setResults(message.results);
        setHuntState((prev) => {
          if (!prev) return prev;
          return { ...prev, phase: 'finished' };
        });
        break;

      case 'teams_updated':
        setAllTeams(message.teams);
        break;

      case 'time_warning':
        setTimeWarning(message.secondsRemaining);
        break;
    }
  }, []);

  const reset = useCallback(() => {
    setHuntState(null);
    setItems([]);
    setMyProgress(null);
    setResults(null);
    setCountdown(null);
    setAppeals([]);
    setVerifyingItems(new Set());
    setTimeWarning(null);
    setAllTeams(null);
  }, []);

  return {
    huntState,
    items,
    myProgress,
    results,
    countdown,
    setCountdown,
    appeals,
    setAppeals,
    verifyingItems,
    timeWarning,
    allTeams,
    handleMessage,
    reset,
  };
}
