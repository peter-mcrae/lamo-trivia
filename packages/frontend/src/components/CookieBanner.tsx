import { useState } from 'react';

const GA_ID = 'G-804RC3BG82';

export function CookieBanner() {
  const [visible, setVisible] = useState(
    () => localStorage.getItem('analytics-consent') === null,
  );

  if (!visible) return null;

  const accept = () => {
    localStorage.setItem('analytics-consent', 'accepted');
    // Load GA dynamically
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments);
    };
    window.gtag('js', new Date());
    window.gtag('config', GA_ID, { send_page_view: false });
    setVisible(false);
  };

  const decline = () => {
    localStorage.setItem('analytics-consent', 'declined');
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
