import { build } from 'esbuild';
import { mkdir, readFile, rm, writeFile, copyFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const sourceHtmlPath = path.join(rootDir, 'index.html');
const manifestPath = path.join(rootDir, 'public', 'manifest.json');

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await build({
  entryPoints: [path.join(rootDir, 'src', 'main.tsx')],
  bundle: true,
  format: 'iife',
  globalName: 'AIRetouchPlugin',
  platform: 'browser',
  target: ['es2020'],
  outfile: path.join(distDir, 'main.js'),
  jsx: 'automatic',
  loader: {
    '.css': 'css',
  },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  sourcemap: false,
  minify: false,
  logLevel: 'info',
});

const sourceHtml = await readFile(sourceHtmlPath, 'utf8');

const distHtml = sourceHtml
  .replace('<script type="module" src="/src/main.tsx"></script>', '<link rel="stylesheet" href="./main.css" />\n    <script src="./main.js"></script>');

await writeFile(path.join(distDir, 'index.html'), distHtml, 'utf8');
await copyFile(manifestPath, path.join(distDir, 'manifest.json'));

// Copy icons directory
const iconsDir = path.join(rootDir, 'public', 'icons');
const distIconsDir = path.join(distDir, 'icons');
try {
  const entries = await readdir(iconsDir);
  await mkdir(distIconsDir, { recursive: true });
  for (const entry of entries) {
    const s = await stat(path.join(iconsDir, entry));
    if (s.isFile()) {
      await copyFile(path.join(iconsDir, entry), path.join(distIconsDir, entry));
    }
  }
} catch { /* icons dir may not exist */ }

