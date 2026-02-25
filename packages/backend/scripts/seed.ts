import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

/**
 * Seed script — reads all JSON files from data/ and uploads to KV.
 *
 * Each JSON file should be an array of Question objects.
 * The filename (without extension) becomes the category ID.
 *
 * Usage:
 *   npm run seed          # seeds local dev KV
 *   npm run seed:remote   # seeds remote/production KV
 *
 * To add a new category, just drop a JSON file in data/:
 *   data/harry-potter.json
 *   data/science.json
 *   data/history.json
 */

const KV_NAMESPACE_ID = '764eda89270249808b1dede3c375f033';
const KV_BINDING = 'TRIVIA_KV';

async function main() {
  const isRemote = process.argv.includes('--remote');
  const dataDir = path.resolve(__dirname, '..', 'data');
  const backendDir = path.resolve(__dirname, '..');

  // Read all JSON files from data/
  const files = fs.readdirSync(dataDir).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    console.error('No JSON files found in data/');
    process.exit(1);
  }

  const counts: Record<string, number> = {};

  console.log(`Seeding to ${isRemote ? 'remote' : 'local'} KV...\n`);

  for (const file of files) {
    const categoryId = path.basename(file, '.json');
    const content = fs.readFileSync(path.join(dataDir, file), 'utf-8');
    const questions = JSON.parse(content) as unknown[];
    counts[categoryId] = questions.length;

    // Write to a temp file for wrangler kv put
    const tmpFile = path.join(backendDir, `.tmp-seed-${categoryId}.json`);
    fs.writeFileSync(tmpFile, content);

    try {
      const localFlag = isRemote ? '' : '--local';
      execSync(
        `npx wrangler kv key put "questions:${categoryId}" --path "${tmpFile}" --namespace-id ${KV_NAMESPACE_ID} ${localFlag}`,
        { cwd: backendDir, stdio: 'pipe' },
      );
      console.log(`  ✓ ${categoryId}: ${questions.length} questions`);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  }

  // Write category metadata
  const metaTmpFile = path.join(backendDir, '.tmp-seed-meta.json');
  fs.writeFileSync(metaTmpFile, JSON.stringify(counts));
  try {
    const localFlag = isRemote ? '' : '--local';
    execSync(
      `npx wrangler kv key put "meta:categories" --path "${metaTmpFile}" --namespace-id ${KV_NAMESPACE_ID} ${localFlag}`,
      { cwd: backendDir, stdio: 'pipe' },
    );
  } finally {
    fs.unlinkSync(metaTmpFile);
  }

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  console.log(`\nSeeded ${total} questions across ${Object.keys(counts).length} categories.`);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
