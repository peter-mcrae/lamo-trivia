import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useGroups } from '@/hooks/useGroups';
import { useAuthContext } from '@/contexts/AuthContext';
import { DeleteGroupModal } from '@/components/DeleteGroupModal';
import { SEO } from '@/components/SEO';
import { api } from '@/lib/api';

export default function Groups() {
  const { groups, addGroup, removeGroup } = useGroups();
  const { user } = useAuthContext();
  const [recovering, setRecovering] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [ownedGroupIds, setOwnedGroupIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<{ groupId: string; name: string } | null>(null);

  // Fetch owned groups to know which ones to show delete button for
  useEffect(() => {
    if (!user) return;
    api.getMyGroups()
      .then(({ groups: owned }) => setOwnedGroupIds(new Set(owned.map((g) => g.groupId))))
      .catch(() => {});
  }, [user]);

  const handleRecover = async () => {
    setRecovering(true);
    try {
      const { groups: owned } = await api.getMyGroups();
      let added = 0;
      for (const g of owned) {
        if (!groups.some((local) => local.groupId === g.groupId)) {
          addGroup(g.groupId, g.name);
          added++;
        }
      }
      setRecovered(true);
      if (added === 0) {
        setTimeout(() => setRecovered(false), 3000);
      }
    } catch {
      console.error('Failed to recover groups');
    } finally {
      setRecovering(false);
    }
  };

  const seo = (
    <SEO
      title="My Groups - LAMO Games"
      description="Create and manage your LAMO game groups. Play trivia, riddle guess, and scavenger hunts with friends and family."
      canonical="https://lamotrivia.app/groups"
    />
  );

  if (!user) {
    return (
      <>{seo}<div className="max-w-lg mx-auto py-10 px-6">
        <div className="text-center py-16">
          <h2 className="text-2xl font-bold text-lamo-dark mb-3">Groups</h2>
          <p className="text-lamo-gray-muted mb-6">
            Sign in to create and manage groups for trivia and scavenger hunts.
          </p>
          <Link
            to="/login?returnTo=/groups"
            className="inline-flex items-center px-6 py-2.5 bg-lamo-blue text-white font-semibold rounded-pill hover:bg-lamo-blue-dark transition-colors"
          >
            Sign In
          </Link>
          <div className="mt-8 border-t border-lamo-border pt-6">
            <p className="text-sm text-lamo-gray-muted mb-3">Have a group code?</p>
            <Link
              to="/group/join"
              className="text-sm text-lamo-blue font-medium hover:underline"
            >
              Join a Group
            </Link>
          </div>
        </div>
      </div></>
    );
  }

  return (
    <>{seo}<div className="max-w-lg mx-auto py-10 px-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-lamo-dark">My Groups</h2>
        <Link
          to="/group/new"
          className="px-5 py-2 bg-lamo-blue text-white text-sm font-semibold rounded-pill hover:bg-lamo-blue-dark transition-colors"
        >
          Create Group
        </Link>
      </div>

      {/* Recovery for signed-in users */}
      <div className="mb-6 p-4 bg-lamo-bg rounded-xl border border-lamo-border">
        <p className="text-sm text-lamo-gray mb-2">
          Signed in as <strong className="text-lamo-dark">{user.email}</strong>
        </p>
        <button
          onClick={handleRecover}
          disabled={recovering}
          className="text-sm text-lamo-blue font-medium hover:underline disabled:opacity-50"
        >
          {recovering ? 'Recovering...' : recovered ? 'Groups recovered!' : 'Recover my groups'}
        </button>
      </div>

      {groups.length > 0 ? (
        <div className="space-y-3 mb-8">
          {groups.map((g) => (
            <div
              key={g.groupId}
              className="flex items-center justify-between p-4 bg-lamo-bg rounded-xl border border-lamo-border"
            >
              <Link
                to={`/group/${g.groupId}`}
                className="min-w-0 flex-1 hover:opacity-80 transition-opacity"
              >
                <h3 className="font-semibold text-lamo-dark">{g.name}</h3>
                <p className="text-xs text-lamo-gray-muted font-mono mt-0.5 truncate">{g.groupId}</p>
              </Link>
              <div className="flex items-center gap-2 shrink-0 ml-3">
                <Link to={`/group/${g.groupId}`} className="text-lamo-blue text-sm font-medium">
                  Open
                </Link>
                {ownedGroupIds.has(g.groupId) && (
                  <button
                    onClick={() => setDeleteTarget({ groupId: g.groupId, name: g.name })}
                    className="text-xs px-2 py-1 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title="Delete group"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 mb-8">
          <p className="text-lamo-gray-muted mb-4">You haven't joined any groups yet.</p>
          <Link
            to="/group/new"
            className="inline-flex items-center px-6 py-2.5 bg-lamo-blue text-white font-semibold rounded-pill hover:bg-lamo-blue-dark transition-colors"
          >
            Create your first group
          </Link>
        </div>
      )}

      {/* Join section */}
      <div className="border-t border-lamo-border pt-6">
        <h3 className="text-sm font-semibold text-lamo-dark mb-3">Join a Group</h3>
        <p className="text-sm text-lamo-gray-muted mb-3">
          Have a group code? Enter it to join.
        </p>
        <Link
          to="/group/join"
          className="inline-flex items-center px-5 py-2 border border-lamo-border text-lamo-dark text-sm font-semibold rounded-pill hover:bg-lamo-bg transition-colors"
        >
          Enter Group Code
        </Link>
      </div>

      {deleteTarget && (
        <DeleteGroupModal
          groupId={deleteTarget.groupId}
          groupName={deleteTarget.name}
          onDeleted={() => {
            removeGroup(deleteTarget.groupId);
            setOwnedGroupIds((prev) => { const next = new Set(prev); next.delete(deleteTarget.groupId); return next; });
            setDeleteTarget(null);
          }}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div></>
  );
}
