import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="text-center py-20 px-6">
      <h2 className="text-4xl font-bold text-lamo-dark mb-4">404</h2>
      <p className="text-lamo-gray-muted mb-8">Page not found.</p>
      <Link
        to="/"
        className="inline-flex items-center px-6 py-2.5 bg-lamo-blue text-white font-semibold rounded-pill hover:bg-lamo-blue-dark transition-colors"
      >
        Back to Home
      </Link>
    </div>
  );
}
