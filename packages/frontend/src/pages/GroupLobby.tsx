import { useParams, useNavigate, Link } from 'react-router-dom';
import { useEffect, useRef, useState, useCallback } from 'react';
import type { GroupServerMessage, HuntHistorySummary } from '@lamo-trivia/shared';
import { useGroupWebSocket } from '@/hooks/useGroupWebSocket';
import { useGroupState } from '@/hooks/useGroupState';
import { useUsername } from '@/hooks/useUsername';
import { useGroups } from '@/hooks/useGroups';
import { useAuthContext } from '@/contexts/AuthContext';
import { UsernameModal } from '@/components/UsernameModal';
import { GroupGameCard } from '@/components/GroupGameCard';
import { CreateGroupGameModal } from '@/components/CreateGroupGameModal';
import { CreateGroupHuntModal } from '@/components/CreateGroupHuntModal';
import { DeleteGroupModal } from '@/components/DeleteGroupModal';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/api';

export default function GroupLobby() {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const { username, setUsername, hasUsername } = useUsername();
  const { addGroup, removeGroup, getMemberId, setMemberId } = useGroups();
  const { user } = useAuthContext();
  const [copied, setCopied] = useState(false);
  const [showNewGameModal, setShowNewGameModal] = useState(false);
  const [showNewHuntModal, setShowNewHuntModal] = useState(false);
  const [showGameTypeChoice, setShowGameTypeChoice] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [inviteNotification, setInviteNotification] = useState<{
    gameId: string;
    gameName: string;
    inviterUsername: string;
  } | null>(null);
  const [huntHistory, setHuntHistory] = useState<HuntHistorySummary[]>([]);
  const joinedRef = useRef(false);
  const inviteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { groupState, error, handleMessage } = useGroupState();

  const onMessage = useCallback(
    (message: GroupServerMessage) => {
      if (message.type === 'join_confirmed') {
        setMemberId(groupId!, message.memberId);
        return;
      }
      if (message.type === 'error' && message.code === 'MEMBER_EXISTS') {
        setShowRecovery(true);
        return;
      }
      if (message.type === 'game_invite') {
        setInviteNotification({
          gameId: message.gameId,
          gameName: message.gameName,
          inviterUsername: message.inviterUsername,
        });
        if (inviteTimerRef.current) clearTimeout(inviteTimerRef.current);
        inviteTimerRef.current = setTimeout(() => setInviteNotification(null), 15000);
        return;
      }
      handleMessage(message);
    },
    [handleMessage, groupId, setMemberId],
  );

  const { connected, send } = useGroupWebSocket({
    groupId: groupId!,
    onMessage,
  });

  // Join group once connected and have username
  useEffect(() => {
    if (connected && hasUsername && !joinedRef.current) {
      joinedRef.current = true;
      const memberId = getMemberId(groupId!);
      send({
        type: 'join_group',
        username: username!,
        ...(memberId ? { memberId } : {}),
      });
    }
  }, [connected, hasUsername, username, send, groupId, getMemberId]);

  // Save group to localStorage once we get state
  useEffect(() => {
    if (groupState) {
      addGroup(groupState.id, groupState.name);
    }
  }, [groupState?.id, groupState?.name, addGroup]);

  // Fetch hunt history for this group
  useEffect(() => {
    if (!groupId) return;
    api.getGroupHuntHistory(groupId)
      .then((res) => setHuntHistory(res.hunts))
      .catch(() => { /* ignore — non-critical */ });
  }, [groupId]);

  // Check if current user is the group owner
  useEffect(() => {
    if (!groupId || !user) return;
    api.getGroup(groupId)
      .then((g) => setIsOwner(g.ownerEmail === user.email))
      .catch(() => {});
  }, [groupId, user]);

  const handleShare = async () => {
    const url = window.location.href;
    const text = `Join my LAMO Trivia group!\nCode: ${groupId}\n${url}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: 'LAMO Trivia Group', text });
        return;
      } catch {
        // User cancelled or share failed — fall through to clipboard
      }
    }

    try {
      await navigator.clipboard.writeText(groupId!);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard failed silently
    }
  };

  const handleGameCreated = (gameId: string) => {
    setShowNewGameModal(false);
    navigate(`/game/${gameId}`);
  };

  const handleHuntCreated = (huntId: string) => {
    setShowNewHuntModal(false);
    navigate(`/hunt/${huntId}`);
  };

  const handleUsernameSubmit = (name: string) => {
    setUsername(name);
  };

  const handleRecover = () => {
    setShowRecovery(false);
    send({ type: 'recover_member', username: username! });
  };

  const handleJoinAsNew = (newName: string) => {
    setShowRenameModal(false);
    setShowRecovery(false);
    setUsername(newName);
    joinedRef.current = false;
    // The join effect will re-trigger with the new username
  };

  // Show username modal if needed
  if (!hasUsername) {
    return <UsernameModal onSubmit={handleUsernameSubmit} />;
  }

  // Recovery prompt — username is taken, ask if it's them
  if (showRecovery) {
    if (showRenameModal) {
      return <UsernameModal onSubmit={handleJoinAsNew} />;
    }

    return (
      <div className="max-w-lg mx-auto py-10 px-6 text-center">
        <div className="bg-lamo-bg border border-lamo-border rounded-2xl p-8">
          <h3 className="text-lg font-bold text-lamo-dark mb-2">Welcome back?</h3>
          <p className="text-sm text-lamo-gray-muted mb-6">
            The username <span className="font-semibold text-lamo-dark">{username}</span> is
            already in this group. Is this you on a new device?
          </p>
          <div className="flex flex-col gap-3">
            <Button onClick={handleRecover}>
              Yes, that's me
            </Button>
            <Button variant="secondary" onClick={() => setShowRenameModal(true)}>
              No, join as someone else
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Loading / error state
  if (!groupState) {
    return (
      <div className="max-w-3xl mx-auto py-10 px-6 text-center">
        {error ? (
          <div>
            <p className="text-red-500 font-medium mb-4">{error}</p>
            <Button onClick={() => navigate('/groups')}>Back to Groups</Button>
          </div>
        ) : (
          <p className="text-lamo-gray-muted">Connecting to group...</p>
        )}
      </div>
    );
  }

  const getGamePath = (game: { gameId: string; gameMode?: string }) => {
    if (game.gameMode === 'scavenger-hunt') return `/hunt/${game.gameId}`;
    if (game.gameMode === 'riddle-wordle') return `/riddle-wordle/${game.gameId}`;
    return `/game/${game.gameId}`;
  };

  const onlineMembers = groupState.members.filter((m) => m.online);
  const waitingGames = groupState.games.filter((g) => g.phase === 'waiting');
  const activeGames = groupState.games.filter((g) => g.phase === 'playing');

  return (
    <div className="max-w-3xl mx-auto py-10 px-6">
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-2xl font-bold text-lamo-dark">{groupState.name}</h2>
        <div className="flex items-center gap-2 mt-1">
          <p className="text-sm text-lamo-gray-muted">
            Code: <span className="font-mono font-bold text-lamo-dark">{groupState.id}</span>
          </p>
          <button
            onClick={handleShare}
            className="text-xs px-2.5 py-1 rounded-full bg-lamo-blue/10 text-lamo-blue font-medium hover:bg-lamo-blue/20 transition-colors"
          >
            {copied ? 'Copied!' : 'Share'}
          </button>
        </div>
      </div>

      {/* New Game */}
      <div className="relative mb-6">
        <Button onClick={() => setShowGameTypeChoice(!showGameTypeChoice)}>New Game</Button>
        {showGameTypeChoice && (
          <div className="absolute left-0 top-full mt-2 w-56 bg-white rounded-xl shadow-lg border border-lamo-border z-40 overflow-hidden">
            <button
              onClick={() => { setShowGameTypeChoice(false); setShowNewGameModal(true); }}
              className="w-full px-4 py-3 text-left hover:bg-lamo-bg transition-colors"
            >
              <p className="text-sm font-medium text-lamo-dark">Trivia</p>
              <p className="text-xs text-lamo-gray">Answer questions in real-time</p>
            </button>
            <button
              onClick={() => { setShowGameTypeChoice(false); navigate('/riddle-wordle'); }}
              className="w-full px-4 py-3 text-left hover:bg-lamo-bg transition-colors border-t border-lamo-border"
            >
              <p className="text-sm font-medium text-lamo-dark">Riddle Guess</p>
              <p className="text-xs text-lamo-gray">Solve riddles letter by letter</p>
            </button>
            <button
              onClick={() => { setShowGameTypeChoice(false); setShowNewHuntModal(true); }}
              className="w-full px-4 py-3 text-left hover:bg-lamo-bg transition-colors border-t border-lamo-border"
            >
              <p className="text-sm font-medium text-lamo-dark">Scavenger Hunt</p>
              <p className="text-xs text-lamo-gray">Find items and snap photos</p>
            </button>
          </div>
        )}
      </div>

      {/* Game invite notification */}
      {inviteNotification && (
        <div className="mb-4 px-4 py-3 bg-lamo-blue/10 border border-lamo-blue/20 rounded-xl flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-lamo-dark">
            {inviteNotification.inviterUsername} invited you to join &ldquo;{inviteNotification.gameName}&rdquo;
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <Button onClick={() => navigate(`/game/${inviteNotification.gameId}`)}>
              Join
            </Button>
            <button
              onClick={() => setInviteNotification(null)}
              className="text-xs text-lamo-gray-muted hover:text-lamo-dark transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Online Members */}
      <div className="mb-8">
        <h3 className="text-sm font-semibold text-lamo-dark mb-3">
          Members Online ({onlineMembers.length})
        </h3>
        <div className="flex flex-wrap gap-2">
          {onlineMembers.map((m) => (
            <span
              key={m.memberId ?? m.username}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-lamo-bg rounded-full text-sm"
            >
              <span className="w-2 h-2 rounded-full bg-green-400" />
              <span className="font-medium text-lamo-dark">{m.username}</span>
            </span>
          ))}
          {onlineMembers.length === 0 && (
            <p className="text-sm text-lamo-gray-muted">No one else is here yet.</p>
          )}
        </div>
      </div>

      {/* Active Games (in progress) */}
      {activeGames.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-lamo-dark mb-3">
            In Progress ({activeGames.length})
          </h3>
          <div className="space-y-3">
            {activeGames.map((game) => (
              <GroupGameCard
                key={game.gameId}
                game={game}
                currentUsername={username ?? undefined}
                onJoin={() => navigate(getGamePath(game))}
              />
            ))}
          </div>
        </div>
      )}

      {/* Waiting Games */}
      <div>
        <h3 className="text-sm font-semibold text-lamo-dark mb-3">
          Open Games ({waitingGames.length})
        </h3>
        {waitingGames.length === 0 && activeGames.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-lamo-gray-muted">No games yet. Use the <strong>New Game</strong> button above to start one!</p>
          </div>
        ) : waitingGames.length === 0 ? (
          <p className="text-sm text-lamo-gray-muted py-4">No open games. Create one to get started!</p>
        ) : (
          <div className="space-y-3">
            {waitingGames.map((game) => (
              <GroupGameCard
                key={game.gameId}
                game={game}
                currentUsername={username ?? undefined}
                onJoin={() => navigate(getGamePath(game))}
              />
            ))}
          </div>
        )}
      </div>

      {/* Past Hunts */}
      {huntHistory.length > 0 && (
        <div className="mt-8 border-t border-lamo-border pt-6">
          <h3 className="text-sm font-semibold text-lamo-dark mb-3">
            Game History ({huntHistory.length})
          </h3>
          <div className="space-y-3">
            {huntHistory.map((hunt) => (
              <Link
                key={hunt.huntId}
                to={`/hunt/${hunt.huntId}/history`}
                className="flex items-center justify-between p-4 bg-lamo-bg rounded-xl border border-lamo-border hover:border-lamo-blue/40 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <h4 className="font-semibold text-lamo-dark text-sm">{hunt.name}</h4>
                  <p className="text-xs text-lamo-gray-muted mt-0.5">
                    {hunt.teamCount} teams · {hunt.totalItems} items · hosted by {hunt.hostUsername}
                  </p>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <p className="text-sm font-medium text-lamo-blue">{hunt.winnerUsername}</p>
                  <p className="text-xs text-lamo-gray-muted">
                    {new Date(hunt.finishedAt).toLocaleDateString()}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Delete Group (owner only) */}
      {isOwner && (
        <div className="mt-8 border-t border-lamo-border pt-6">
          <button
            onClick={() => setShowDeleteModal(true)}
            className="text-sm text-red-500 hover:text-red-700 font-medium transition-colors"
          >
            Delete Group
          </button>
        </div>
      )}

      {/* Delete Group Modal */}
      {showDeleteModal && (
        <DeleteGroupModal
          groupId={groupId!}
          groupName={groupState.name}
          onDeleted={() => {
            removeGroup(groupId!);
            navigate('/groups');
          }}
          onClose={() => setShowDeleteModal(false)}
        />
      )}

      {/* New Game Modal */}
      {showNewGameModal && (
        <CreateGroupGameModal
          groupId={groupId!}
          onGameCreated={handleGameCreated}
          onClose={() => setShowNewGameModal(false)}
        />
      )}

      {/* New Hunt Modal */}
      {showNewHuntModal && (
        <CreateGroupHuntModal
          groupId={groupId!}
          onHuntCreated={handleHuntCreated}
          onClose={() => setShowNewHuntModal(false)}
        />
      )}
    </div>
  );
}
