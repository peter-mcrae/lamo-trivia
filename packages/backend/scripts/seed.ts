import { unstable_dev } from 'wrangler';

/**
 * Seed script — pushes all question data from TypeScript source files into KV.
 *
 * Usage:
 *   npm run seed          # seeds local dev KV (via wrangler dev)
 *   npm run seed:remote   # seeds remote/production KV
 */
async function main() {
  const isRemote = process.argv.includes('--remote');

  console.log(`Seeding questions to ${isRemote ? 'remote' : 'local'} KV...`);

  const worker = await unstable_dev('src/index.ts', {
    experimental: { disableExperimentalWarning: true },
    local: !isRemote,
  });

  try {
    const response = await worker.fetch('http://localhost/api/seed', {
      method: 'POST',
    });
    const result = await response.json() as Record<string, unknown>;
    console.log('Seed complete:', result);
  } finally {
    await worker.stop();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
