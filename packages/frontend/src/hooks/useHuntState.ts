import { useState, useCallback } from 'react';
import type {
  ClientHuntState, HuntItem, HuntPlayerProgress,
  HuntResults, HuntAppeal, HuntServerMessage, Player, HuntTeamSummary,
} from '@lamo-trivia/shared';
import { saveHostSecret } from './useHuntHostSecrets';

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
  const [rejectedItems, setRejectedItems] = useState<Map<string, string>>(new Map());
  const [deniedItems, setDeniedItems] = useState<Map<string, string>>(new Map());
  const [hostMessages, setHostMessages] = useState<string[]>([]);

  const handleMessage = useCallback((message: HuntServerMessage) => {
    switch (message.type) {
      case 'hunt_state':
        setHuntState(message.state);
        setMyProgress(message.state.myProgress);
        if (message.state.allTeams) {
          setAllTeams(message.state.allTeams);
        }
        // Rebuild verifyingItems from items with pending_review status (e.g. after rejoin)
        if (message.state.myProgress?.items) {
          setVerifyingItems(new Set(
            Object.values(message.state.myProgress.items)
              .filter((item: any) => item.status === 'pending_review')
              .map((item: any) => item.itemId),
          ));
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
        // Initialize myProgress.items so handlers like photo_accepted can find them
        setMyProgress((prev) => {
          if (!prev) return prev;
          const updatedItems = { ...prev.items };
          for (const item of message.items) {
            if (!updatedItems[item.id]) {
              updatedItems[item.id] = {
                itemId: item.id,
                status: 'searching' as const,
                cluesRevealed: [],
                attemptsUsed: 0,
              };
            }
          }
          return { ...prev, items: updatedItems };
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
        setRejectedItems((prev) => {
          const next = new Map(prev);
          next.delete(message.itemId);
          return next;
        });
        setDeniedItems((prev) => {
          const next = new Map(prev);
          next.delete(message.itemId);
          return next;
        });
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
        setRejectedItems((prev) => {
          const next = new Map(prev);
          next.set(message.itemId, message.reason);
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
              [message.itemId]: {
                ...itemProgress,
                status: 'searching' as const,
                attemptsUsed: message.attemptsUsed,
              },
            },
          };
        });
        break;

      case 'appeal_submitted':
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
              [message.itemId]: {
                ...itemProgress,
                status: 'rejected' as const,
                attemptsUsed: message.attemptsUsed,
              },
            },
          };
        });
        break;

      case 'appeal_received':
        setAppeals((prev) => [...prev, message.appeal]);
        break;

      case 'appeal_approved':
        setVerifyingItems((prev) => {
          const next = new Set(prev);
          next.delete(message.itemId);
          return next;
        });
        setRejectedItems((prev) => {
          const next = new Map(prev);
          next.delete(message.itemId);
          return next;
        });
        setDeniedItems((prev) => {
          const next = new Map(prev);
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

      case 'appeal_rejected':
        setVerifyingItems((prev) => {
          const next = new Set(prev);
          next.delete(message.itemId);
          return next;
        });
        // Clear AI rejection reason so contest button doesn't reappear
        setRejectedItems((prev) => {
          const next = new Map(prev);
          next.delete(message.itemId);
          return next;
        });
        // Show host denial feedback
        setDeniedItems((prev) => {
          const next = new Map(prev);
          next.set(
            message.itemId,
            message.returnToSearching
              ? 'Host denied your appeal. Try a different photo.'
              : 'Host denied your appeal — no attempts remaining.',
          );
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
              [message.itemId]: {
                ...itemProgress,
                status: message.returnToSearching ? 'searching' as const : 'rejected' as const,
              },
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

      case 'hunt_history_saved':
        saveHostSecret(message.huntId, message.hostSecret);
        break;

      case 'host_message':
        setHostMessages((prev) => [...prev, message.message]);
        break;

      case 'time_warning':
        setTimeWarning(message.secondsRemaining);
        break;

      case 'credits_deducted':
        // Acknowledged — credits info is informational for the host
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
    setRejectedItems(new Map());
    setDeniedItems(new Map());
    setHostMessages([]);
  }, []);

  const dismissHostMessage = useCallback((index: number) => {
    setHostMessages((prev) => prev.filter((_, i) => i !== index));
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
    rejectedItems,
    deniedItems,
    hostMessages,
    dismissHostMessage,
    handleMessage,
    reset,
  };
}
