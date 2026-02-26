import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export function hasAnalyticsConsent(): boolean {
  return localStorage.getItem('analytics-consent') === 'accepted';
}

export function usePageTracking() {
  const location = useLocation();

  useEffect(() => {
    if (hasAnalyticsConsent() && window.gtag) {
      window.gtag('event', 'page_view', {
        page_path: location.pathname + location.search,
        page_title: document.title,
      });
    }
  }, [location]);
}
