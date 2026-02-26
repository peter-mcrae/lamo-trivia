import { useState } from 'react';

export function CookieBanner() {
  const [visible, setVisible] = useState(
    () => localStorage.getItem('analytics-consent') === null,
  );

  if (!visible) return null;

  const accept = () => {
    localStorage.setItem('analytics-consent', 'accepted');
    setVisible(false);
  };

  const decline = () => {
    localStorage.setItem('analytics-consent', 'declined');
    // Disable GA — prevent further tracking
    window['ga-disable-G-804RC3BG82' as keyof Window] = true as never;
    setVisible(false);
  };

  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:max-w-sm z-50 bg-white border border-lamo-border rounded-xl shadow-lg px-4 py-3 flex items-center gap-3 text-sm animate-fade-in-up">
      <p className="text-lamo-gray-muted flex-1">
        We use cookies for analytics.
      </p>
      <button
        onClick={decline}
        className="text-lamo-gray-muted hover:text-lamo-dark transition-colors shrink-0"
      >
        Decline
      </button>
      <button
        onClick={accept}
        className="px-3 py-1 bg-lamo-blue text-white font-medium rounded-full hover:bg-lamo-blue-dark transition-colors shrink-0"
      >
        OK
      </button>
    </div>
  );
}
