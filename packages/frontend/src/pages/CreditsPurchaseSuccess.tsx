import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuthContext } from '@/contexts/AuthContext';

export default function CreditsPurchaseSuccess() {
  const { refreshUser } = useAuthContext();

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  return (
    <div className="max-w-md mx-auto px-6 py-16 text-center">
      <div className="text-5xl mb-4">&#10003;</div>
      <h1 className="text-2xl font-bold text-lamo-dark mb-2">Credits Added!</h1>
      <p className="text-lamo-gray-muted mb-8">
        Your credits have been added to your account. You're ready to host scavenger hunts!
      </p>
      <div className="flex gap-4 justify-center">
        <Link
          to="/credits"
          className="px-6 py-2.5 bg-lamo-bg border border-lamo-border text-lamo-dark font-medium rounded-lg hover:bg-lamo-bg/80 transition-colors"
        >
          View Balance
        </Link>
        <Link
          to="/groups"
          className="px-6 py-2.5 bg-lamo-primary text-white font-medium rounded-lg hover:bg-lamo-primary/90 transition-colors"
        >
          Go to My Groups
        </Link>
      </div>
    </div>
  );
}
