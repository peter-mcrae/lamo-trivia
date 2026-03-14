import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useHuntWebSocket } from '../hooks/useHuntWebSocket';
import { useHuntState } from '../hooks/useHuntState';
import { usePhotoUpload } from '../hooks/usePhotoUpload';
import { useUsername } from '../hooks/useUsername';
import { UsernameModal } from '../components/UsernameModal';
import { PlayerList } from '../components/PlayerList';
import { HuntTimer } from '../components/HuntTimer';
import { HuntItemCard } from '../components/HuntItemCard';
import { PhotoCapture } from '../components/PhotoCapture';
import { AppealBanner } from '../components/AppealBanner';
import { HuntResults } from '../components/HuntResults';
import { HostDashboard } from '../components/HostDashboard';
import { Button } from '../components/ui/Button';

export default function HuntRoom() {
  const { huntId } = useParams<{ huntId: string }>();
  const navigate = useNavigate();
  const { username, setUsername, hasUsername } = useUsername();
  const [error, setError] = useState<string | null>(null);
  const [startingHunt, setStartingHunt] = useState(false);
  const [copied, setCopied] = useState(false);
  const [photoCaptureItemId, setPhotoCaptureItemId] = useState<string | null>(null);
  const joinedRef = useRef(false);
  const hasJoinedOnceRef = useRef(false);

  const {
    huntState,
    items,
    myProgress,
    results,
    countdown,
    setCountdown,
    appeals,
    setAppeals,
    verifyingItems,
    allTeams,
    handleMessage,
    reset: resetHuntState,
  } = useHuntState();

  const { uploadPhoto, uploading } = usePhotoUpload(huntId!);

  const onMessage = useCallback(
    (message: Parameters<typeof handleMessage>[0]) => {
      if (message.type === 'error') {
        // Don't show HUNT_STARTED as a user error — the auto-rejoin in handleJoin covers it
        if (message.code === 'HUNT_STARTED' || message.code === 'PLAYER_NOT_FOUND') {
          setError(message.message);
        } else {
          setError(message.message);
        }
        return;
      }
      if (message.type === 'hunt_expired') {
        setError('This hunt has expired. Returning...');
        setTimeout(() => navigate('/lobby'), 3000);
        return;
      }
      // Clear errors on successful state receipt
      if (message.type === 'hunt_state') {
        setError(null);
      }
      handleMessage(message);
    },
    [handleMessage, navigate],
  );

  const { connected, send } = useHuntWebSocket({
    huntId: huntId!,
    onMessage,
  });

  // Reset all state when navigating to a new hunt
  useEffect(() => {
    joinedRef.current = false;
    hasJoinedOnceRef.current = false;
    resetHuntState();
    setError(null);
    setStartingHunt(false);
    setPhotoCaptureItemId(null);
  }, [huntId, resetHuntState]);

  // Join or rejoin hunt once connected and have a username
  useEffect(() => {
    if (connected && hasUsername && !joinedRef.current) {
      // If we've joined before (reconnecting), use rejoin_hunt
      const messageType = hasJoinedOnceRef.current ? 'rejoin_hunt' : 'join_hunt';
      if (send({ type: messageType, huntId: huntId!, username: username! } as any)) {
        joinedRef.current = true;
        hasJoinedOnceRef.current = true;
      }
    }
    // Reset joinedRef when disconnected so we rejoin on reconnect
    if (!connected) {
      joinedRef.current = false;
    }
  }, [connected, hasUsername, huntId, username, send]);

  // Countdown timer for "starting" phase (3 -> 2 -> 1)
  useEffect(() => {
    if (huntState?.phase !== 'starting' || countdown === null || countdown <= 0) return;
    const id = setTimeout(() => setCountdown((c) => (c !== null ? c - 1 : c)), 1000);
    return () => clearTimeout(id);
  }, [huntState?.phase, countdown, setCountdown]);

  // Clear loading state when hunt phase advances or an error arrives
  useEffect(() => {
    if (startingHunt && huntState?.phase && huntState.phase !== 'waiting') {
      setStartingHunt(false);
    }
  }, [startingHunt, huntState?.phase]);

  useEffect(() => {
    if (error) setStartingHunt(false);
  }, [error]);

  const handleStartHunt = () => {
    setStartingHunt(true);
    setError(null);
    send({ type: 'start_hunt' });
  };

  const handleShare = async () => {
    const url = window.location.href;
    const text = `Join my LAMO scavenger hunt!\n${huntState?.config.name ?? 'Hunt'} -- Code: ${huntState?.id}\n${url}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: 'LAMO Scavenger Hunt', text });
        return;
      } catch {
        // User cancelled or share failed -- fall through to clipboard
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard failed silently
    }
  };

  const handleClaimHost = () => {
    send({ type: 'claim_host' });
  };

  const handleRevealClue = (itemId: string, clueId: string) => {
    send({ type: 'reveal_clue', itemId, clueId });
  };

  const handleTakePhoto = (itemId: string) => {
    setPhotoCaptureItemId(itemId);
  };

  const handlePhotoCapture = async (file: File) => {
    if (!photoCaptureItemId) return;
    const itemId = photoCaptureItemId;
    setPhotoCaptureItemId(null);

    const uploadId = await uploadPhoto(file, itemId);
    if (uploadId) {
      send({ type: 'submit_photo', itemId, uploadId });
    }
  };

  const handleApproveAppeal = (playerId: string, itemId: string) => {
    send({ type: 'approve_appeal', playerId, itemId });
    setAppeals((prev) =>
      prev.filter((a) => !(a.playerId === playerId && a.itemId === itemId)),
    );
  };

  const handleRejectAppeal = (playerId: string, itemId: string) => {
    send({ type: 'reject_appeal', playerId, itemId });
    setAppeals((prev) =>
      prev.filter((a) => !(a.playerId === playerId && a.itemId === itemId)),
    );
  };

  const handleUsernameSubmit = (name: string) => {
    setUsername(name);
  };

  // Show username modal if needed
  if (!hasUsername) {
    return <UsernameModal onSubmit={handleUsernameSubmit} />;
  }

  // Loading state
  if (!huntState) {
    return (
      <div className="max-w-3xl mx-auto py-10 px-6 text-center">
        {error ? (
          <div>
            <p className="text-red-500 font-medium mb-4">{error}</p>
            <Button onClick={() => navigate('/lobby')}>Back to Lobby</Button>
          </div>
        ) : (
          <p className="text-lamo-gray-muted">Connecting to hunt...</p>
        )}
      </div>
    );
  }

  const isHost = huntState.players.find((p) => p.username === username)?.id === huntState.hostId;
  const teamCount = huntState.players.filter((p) => p.id !== huntState.hostId).length;
  const canStart = isHost && teamCount >= huntState.config.minPlayers;

  return (
    <div className="max-w-3xl mx-auto py-10 px-6">
      {/* Error banner */}
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
          {error}
        </div>
      )}

      {/* Connection status */}
      {!connected && (
        <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-600 text-sm flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          Reconnecting...
        </div>
      )}

      {/* Upload status */}
      {uploading && (
        <div className="mb-4 px-4 py-3 bg-lamo-blue/5 border border-lamo-blue/20 rounded-xl text-lamo-blue text-sm flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-lamo-blue/30 border-t-lamo-blue rounded-full animate-spin" />
          Uploading photo...
        </div>
      )}

      {/* Waiting Phase */}
      {huntState.phase === 'waiting' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-2xl font-bold text-lamo-dark">{huntState.config.name}</h2>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-lamo-gray-muted text-sm">
                  Hunt Code: <span className="font-mono font-bold text-lamo-dark">{huntState.id}</span>
                </p>
                <button
                  onClick={handleShare}
                  className="text-xs px-2.5 py-1 rounded-full bg-lamo-blue/10 text-lamo-blue font-medium hover:bg-lamo-blue/20 transition-colors"
                >
                  {copied ? 'Copied!' : 'Share'}
                </button>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm text-lamo-gray-muted">
                {huntState.players.length} / {huntState.config.maxPlayers} teams
              </p>
              <p className="text-xs text-lamo-gray-muted mt-0.5">
                Need {huntState.config.minPlayers} teams to start
              </p>
            </div>
          </div>

          {/* Hunt info */}
          <div className="mb-6 px-4 py-3 bg-lamo-bg rounded-xl border border-lamo-border">
            <div className="flex items-center justify-between text-sm">
              <span className="text-lamo-gray-muted">Items to find</span>
              <span className="font-medium text-lamo-dark">{huntState.config.items.length}</span>
            </div>
            <div className="flex items-center justify-between text-sm mt-1.5">
              <span className="text-lamo-gray-muted">Duration</span>
              <span className="font-medium text-lamo-dark">{huntState.config.durationMinutes} min</span>
            </div>
            <div className="flex items-center justify-between text-sm mt-1.5">
              <span className="text-lamo-gray-muted">Max attempts per item</span>
              <span className="font-medium text-lamo-dark">{huntState.config.maxRetries}</span>
            </div>
          </div>

          <div className="mb-6">
            <h3 className="text-sm font-semibold text-lamo-dark mb-3">Teams</h3>
            <PlayerList players={huntState.players} hostId={huntState.hostId} />
          </div>

          {startingHunt ? (
            <div className="flex flex-col items-center py-6 gap-3">
              <div className="w-8 h-8 border-4 border-lamo-blue/30 border-t-lamo-blue rounded-full animate-spin" />
              <p className="text-sm text-lamo-gray-muted">Starting hunt...</p>
            </div>
          ) : (
            <div className="flex gap-3">
              {isHost && (
                <Button onClick={handleStartHunt} disabled={!canStart}>
                  {canStart ? 'Start Hunt' : `Need ${huntState.config.minPlayers - teamCount} more teams`}
                </Button>
              )}
              {!isHost && (
                <div className="flex items-center gap-3">
                  <p className="text-sm text-lamo-gray-muted py-2">Waiting for host to start...</p>
                  <button
                    onClick={handleClaimHost}
                    className="text-xs px-2.5 py-1 rounded-full border border-lamo-border text-lamo-gray-muted hover:text-lamo-dark hover:border-lamo-blue/40 transition-colors"
                  >
                    Claim Host
                  </button>
                </div>
              )}
              <Button variant="secondary" onClick={() => navigate('/lobby')}>
                Leave
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Starting Phase -- Countdown */}
      {huntState.phase === 'starting' && countdown !== null && (
        <div className="flex flex-col items-center justify-center py-20">
          <p className="text-lamo-gray-muted mb-4">Hunt starting in</p>
          <div className="text-7xl font-bold text-lamo-blue animate-pulse">{countdown}</div>
          <p className="text-sm text-lamo-gray-muted mt-6">Get ready to hunt!</p>
        </div>
      )}

      {/* Playing Phase */}
      {huntState.phase === 'playing' && (
        <div>
          {isHost && allTeams ? (
            <HostDashboard
              teams={allTeams}
              items={items}
              endsAt={huntState.endsAt!}
              appeals={appeals}
              onApprove={handleApproveAppeal}
              onReject={handleRejectAppeal}
            />
          ) : (
            <>
              {/* Timer */}
              {huntState.endsAt && (
                <div className="mb-6">
                  <HuntTimer endsAt={huntState.endsAt} />
                </div>
              )}

              {/* Score summary */}
              {myProgress && (
                <div className="mb-6 flex items-center justify-between px-4 py-3 bg-lamo-bg rounded-xl border border-lamo-border">
                  <span className="text-sm text-lamo-gray-muted">Your Score</span>
                  <span className="text-lg font-bold text-lamo-blue">{myProgress.totalScore} pts</span>
                </div>
              )}

              {/* Item list */}
              <div className="space-y-4">
                {items.map((item) => {
                  const progress = myProgress?.items[item.id] ?? {
                    itemId: item.id,
                    status: 'searching' as const,
                    cluesRevealed: [],
                    attemptsUsed: 0,
                  };

                  return (
                    <HuntItemCard
                      key={item.id}
                      item={item}
                      progress={progress}
                      isVerifying={verifyingItems.has(item.id)}
                      maxRetries={huntState.config.maxRetries}
                      onRevealClue={handleRevealClue}
                      onTakePhoto={handleTakePhoto}
                    />
                  );
                })}
              </div>

              {/* Photo capture modal */}
              {photoCaptureItemId && (
                <PhotoCapture
                  onCapture={handlePhotoCapture}
                  onClose={() => setPhotoCaptureItemId(null)}
                />
              )}
            </>
          )}
        </div>
      )}

      {/* Finished Phase */}
      {huntState.phase === 'finished' && results && (
        <div>
          <HuntResults results={results} players={huntState.players} />

          <div className="flex justify-center gap-3 mt-8">
            <Button variant="secondary" onClick={() => navigate('/lobby')}>
              Back to Lobby
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
