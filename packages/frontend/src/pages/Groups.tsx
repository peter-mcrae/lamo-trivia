import { Link } from 'react-router-dom';
import { useGroups } from '@/hooks/useGroups';

export default function Groups() {
  const { groups } = useGroups();

  return (
    <div className="max-w-lg mx-auto py-10 px-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-lamo-dark">My Groups</h2>
        <Link
          to="/group/new"
          className="px-5 py-2 bg-lamo-blue text-white text-sm font-semibold rounded-pill hover:bg-lamo-blue-dark transition-colors"
        >
          Create Group
        </Link>
      </div>

      {groups.length > 0 ? (
        <div className="space-y-3 mb-8">
          {groups.map((g) => (
            <Link
              key={g.groupId}
              to={`/group/${g.groupId}`}
              className="flex items-center justify-between p-4 bg-lamo-bg rounded-xl border border-lamo-border hover:border-lamo-blue/40 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-lamo-dark">{g.name}</h3>
                <p className="text-xs text-lamo-gray-muted font-mono mt-0.5 truncate">{g.groupId}</p>
              </div>
              <span className="text-lamo-blue text-sm font-medium shrink-0 ml-3">Open</span>
            </Link>
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
    </div>
  );
}
