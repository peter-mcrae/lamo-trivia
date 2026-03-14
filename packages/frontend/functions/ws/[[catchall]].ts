interface Env {
  API: Fetcher;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  return context.env.API.fetch(context.request);
};
