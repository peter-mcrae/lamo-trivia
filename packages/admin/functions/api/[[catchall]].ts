// Proxy /api/* requests to the backend API, forwarding the
// Cf-Access-Jwt-Assertion header that Cloudflare Access injects
// on same-origin requests to the protected admin domain.

const API_ORIGIN = 'https://api.lamotrivia.app';

export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  const target = `${API_ORIGIN}${url.pathname}${url.search}`;

  const headers = new Headers(context.request.headers);
  // Remove host header so the backend sees the correct host
  headers.delete('host');

  const response = await fetch(target, {
    method: context.request.method,
    headers,
    body: context.request.method !== 'GET' && context.request.method !== 'HEAD'
      ? context.request.body
      : undefined,
  });

  // Return the response directly (no need for CORS — same-origin)
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
};
