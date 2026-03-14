import { Link } from 'react-router-dom';
import { useAuthContext } from '@/contexts/AuthContext';

export default function CreateHunt() {
  const { user } = useAuthContext();

  return (
    <div className="max-w-lg mx-auto py-10 px-6">
      <h2 className="text-2xl font-bold text-lamo-dark mb-2">Scavenger Hunts</h2>
      <p className="text-lamo-gray mb-8">
        Create AI-powered photo scavenger hunts for your family and friends.
        Players find real-world items and snap photos — AI verifies them instantly.
      </p>

      {/* How it works */}
      <div className="bg-lamo-bg rounded-xl border border-lamo-border p-6 mb-6">
        <h3 className="font-semibold text-lamo-dark mb-4">How it works</h3>
        <ol className="space-y-3 text-sm text-lamo-gray">
          <li className="flex gap-3">
            <span className="font-bold text-lamo-dark shrink-0">1.</span>
            <span><strong className="text-lamo-dark">Create or join a private group</strong> — groups are your home base for organizing hunts with family and friends.</span>
          </li>
          <li className="flex gap-3">
            <span className="font-bold text-lamo-dark shrink-0">2.</span>
            <span><strong className="text-lamo-dark">Start a scavenger hunt</strong> from within your group — define the items to find, set the time limit, and go.</span>
          </li>
          <li className="flex gap-3">
            <span className="font-bold text-lamo-dark shrink-0">3.</span>
            <span><strong className="text-lamo-dark">Players snap photos</strong> of items they find. AI vision verifies each photo in real-time.</span>
          </li>
        </ol>
      </div>

      {/* Credits info */}
      <div className="bg-lamo-bg rounded-xl border border-lamo-border p-6 mb-8">
        <h3 className="font-semibold text-lamo-dark mb-2">Credits</h3>
        <p className="text-sm text-lamo-gray">
          Scavenger hunts use credits for AI photo verification.
          The hunt creator needs credits — players don't.
          {user && (
            <span> Your balance: <strong className="text-lamo-dark">{user.credits} credits</strong>. <Link to="/credits" className="text-lamo-blue hover:underline">Buy more</Link></span>
          )}
        </p>
      </div>

      {/* CTAs */}
      <div className="space-y-3">
        {!user && (
          <Link
            to="/login"
            className="block w-full text-center px-6 py-3 bg-lamo-blue text-white font-semibold rounded-pill hover:bg-lamo-blue-dark transition-colors"
          >
            Sign In to Get Started
          </Link>
        )}
        <Link
          to="/group/new"
          className="block w-full text-center px-6 py-3 bg-lamo-blue text-white font-semibold rounded-pill hover:bg-lamo-blue-dark transition-colors"
        >
          Create a Group
        </Link>
        <Link
          to="/groups"
          className="block w-full text-center px-6 py-3 border border-lamo-border text-lamo-dark font-semibold rounded-pill hover:bg-lamo-bg transition-colors"
        >
          My Groups
        </Link>
        <Link
          to="/group/join"
          className="block w-full text-center px-6 py-3 border border-lamo-border text-lamo-dark font-semibold rounded-pill hover:bg-lamo-bg transition-colors"
        >
          Join a Group with a Code
        </Link>
      </div>
    </div>
  );
}
