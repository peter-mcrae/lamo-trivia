import fs from 'node:fs';
import path from 'node:path';
import { unstable_dev } from 'wrangler';

/**
 * Seed script — reads all JSON files from data/ and uploads to KV.
 *
 * Each JSON file should be an array of Question objects.
 * The filename (without extension) becomes the category ID.
 *
 * Usage:
 *   npm run seed          # seeds local dev KV (via wrangler dev)
 *   npm run seed:remote   # seeds remote/production KV
 *
 * To add a new category, just drop a JSON file in data/:
 *   data/harry-potter.json
 *   data/science.json
 *   data/history.json
 */
async function main() {
  const isRemote = process.argv.includes('--remote');
  const dataDir = path.resolve(__dirname, '..', 'data');

  // Read all JSON files from data/
  const files = fs.readdirSync(dataDir).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    console.error('No JSON files found in data/');
    process.exit(1);
  }

  const categories: Record<string, unknown[]> = {};
  for (const file of files) {
    const categoryId = path.basename(file, '.json');
    const content = fs.readFileSync(path.join(dataDir, file), 'utf-8');
    const questions = JSON.parse(content) as unknown[];
    categories[categoryId] = questions;
    console.log(`  ${categoryId}: ${questions.length} questions`);
  }

  console.log(`\nSeeding ${Object.keys(categories).length} categories to ${isRemote ? 'remote' : 'local'} KV...`);

  const worker = await unstable_dev('src/index.ts', {
    experimental: { disableExperimentalWarning: true },
    local: !isRemote,
  });

  try {
    const response = await worker.fetch('http://localhost/api/seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(categories),
    });
    const result = (await response.json()) as Record<string, unknown>;
    console.log('Seed complete:', result);
  } finally {
    await worker.stop();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
