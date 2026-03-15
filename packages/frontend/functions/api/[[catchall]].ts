interface Env {
  API: Fetcher;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  // Forward the original request to the Worker via service binding.
  // Pass the original request so headers (including Origin) are preserved.
  const response = await context.env.API.fetch(context.request);

  // Clone response headers so we can ensure CORS headers pass through
  const headers = new Headers(response.headers);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
