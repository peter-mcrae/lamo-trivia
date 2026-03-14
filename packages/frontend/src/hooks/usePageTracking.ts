import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/** Random client ID per browser session for GA4 server-side tracking */
function getClientId(): string {
  let cid = sessionStorage.getItem('_cid');
  if (!cid) {
    cid = crypto.randomUUID();
    sessionStorage.setItem('_cid', cid);
  }
  return cid;
}

export function usePageTracking() {
  const location = useLocation();

  useEffect(() => {
    const payload = {
      p: location.pathname + location.search,
      t: document.title,
      cid: getClientId(),
    };

    fetch('/api/t', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  }, [location]);
}
