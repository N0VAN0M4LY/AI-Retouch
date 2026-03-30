/**
 * Build a .ccx package from the UXP plugin dist/ directory.
 * Follows the same logic as Adobe UXP Developer Tool's PluginPackageCommand:
 *  - Re-serializes manifest.json (ensures host is single object, not array)
 *  - Adds files individually (respects .gitignore / .npmignore)
 *  - Skips hidden files, lock files, test dirs, existing .ccx
 *
 * Usage: node scripts/build-ccx.js
 * Output: apps/plugin/release/ai-retouch-plugin.ccx
 */

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const PLUGIN_DIST = path.resolve(__dirname, '..', 'apps', 'plugin', 'dist');
const PLUGIN_RELEASE = path.resolve(__dirname, '..', 'apps', 'plugin', 'release');

const IGNORED_FILES = [
  '.uxprc', '.gitignore', 'yarn.lock', '.npmignore',
  '.DS_Store', 'manifest.json', 'package-lock.json',
];

function getFiles(dir, base) {
  base = base || '';
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (IGNORED_FILES.includes(entry.name)) continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === 'uxp-plugin-tests') continue;
      results.push(...getFiles(path.join(dir, entry.name), rel));
    } else {
      if (entry.name.endsWith('.ccx') || entry.name.endsWith('.xdx')) continue;
      results.push(rel);
    }
  }
  return results;
}

async function main() {
  if (!fs.existsSync(PLUGIN_DIST)) {
    console.error(`[build-ccx] Plugin dist not found: ${PLUGIN_DIST}`);
    console.error('[build-ccx] Run "pnpm build:shared && pnpm --filter @ai-retouch/plugin build" first.');
    process.exit(1);
  }

  const manifest = JSON.parse(
    fs.readFileSync(path.join(PLUGIN_DIST, 'manifest.json'), 'utf-8'),
  );

  // UDT converts host array to single object per package
  if (Array.isArray(manifest.host)) {
    manifest.host = manifest.host[0];
  }

  const version = manifest.version || '0.0.0';
  const pluginId = manifest.id || 'plugin';
  const hostApp = manifest.host?.app || 'PS';

  fs.mkdirSync(PLUGIN_RELEASE, { recursive: true });

  const ccxFilename = `${pluginId}_${hostApp}.ccx`;
  const ccxPath = path.join(PLUGIN_RELEASE, ccxFilename);

  if (fs.existsSync(ccxPath)) fs.unlinkSync(ccxPath);

  console.log(`[build-ccx] Packaging plugin v${version} for ${hostApp}...`);
  console.log(`[build-ccx] Source: ${PLUGIN_DIST}`);
  console.log(`[build-ccx] Output: ${ccxPath}`);

  const output = fs.createWriteStream(ccxPath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  const result = new Promise((resolve, reject) => {
    output.on('close', () => resolve(archive.pointer()));
    archive.on('error', reject);
  });

  archive.pipe(output);

  // Write re-serialized manifest (matching UDT behavior)
  archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

  // Add all other files individually
  const files = getFiles(PLUGIN_DIST);
  for (const file of files) {
    archive.append(fs.createReadStream(path.join(PLUGIN_DIST, file)), { name: file });
  }

  await archive.finalize();

  const bytes = await result;
  console.log(`[build-ccx] Done! ${ccxFilename} (${(bytes / 1024).toFixed(1)} KB)`);

  // Also create stable name for Electron bundling
  const stableCcxPath = path.join(PLUGIN_RELEASE, 'ai-retouch-plugin.ccx');
  fs.copyFileSync(ccxPath, stableCcxPath);
  console.log(`[build-ccx] Stable copy: ai-retouch-plugin.ccx`);
}

main().catch((err) => {
  console.error('[build-ccx] Fatal:', err);
  process.exit(1);
});
