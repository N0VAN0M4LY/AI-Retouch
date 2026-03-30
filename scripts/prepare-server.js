/**
 * Prepares the server for embedding in the Electron app.
 *
 * 1. Builds server in CJS format with sharp externalized
 * 2. Compiles the bundle to V8 bytecode via bytenode
 * 3. Creates a minimal distribution package with sharp + bytenode
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(ROOT, 'apps', 'server');
const ELECTRON_DIR = path.join(ROOT, 'apps', 'electron');
const TARGET_DIR = path.join(ELECTRON_DIR, 'resources', 'server');
const DIST_PACK = path.join(SERVER_DIR, 'dist-pack');

function run(cmd, cwd) {
  console.log(`  > ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

// ─── Step 1: Build server (CJS, sharp externalized) ───

console.log('\n[prepare-server] Step 1: Building server (CJS, sharp externalized)...');
run('pnpm build:pack', SERVER_DIR);

const bundlePath = path.join(DIST_PACK, 'index.cjs');
if (!fs.existsSync(bundlePath)) {
  console.error(`[prepare-server] ERROR: Expected ${bundlePath} not found.`);
  console.log('[prepare-server] Checking dist-pack contents...');
  const files = fs.readdirSync(DIST_PACK);
  console.log('  Files:', files);
  const jsFile = files.find(f => f.endsWith('.cjs') || f.endsWith('.js'));
  if (jsFile) {
    console.log(`  Found: ${jsFile}, renaming to index.cjs`);
    fs.renameSync(path.join(DIST_PACK, jsFile), bundlePath);
  } else {
    throw new Error('No server bundle found in dist-pack/');
  }
}

// ─── Step 2: Compile to V8 bytecode using Electron's Node.js ───

console.log('\n[prepare-server] Step 2: Compiling to V8 bytecode (using Electron V8)...');

const bytenodeScript = path.join(ELECTRON_DIR, 'node_modules', 'bytenode', 'lib', 'cli.js');
const bytenodeScriptAlt = path.join(ROOT, 'node_modules', 'bytenode', 'lib', 'cli.js');
const bnScript = fs.existsSync(bytenodeScript) ? bytenodeScript : bytenodeScriptAlt;

const electronDistDir = path.join(ELECTRON_DIR, 'node_modules', 'electron', 'dist');
const electronBin = process.platform === 'win32'
  ? path.join(electronDistDir, 'electron.exe')
  : process.platform === 'darwin'
    ? path.join(electronDistDir, 'Electron.app', 'Contents', 'MacOS', 'Electron')
    : path.join(electronDistDir, 'electron');

if (!fs.existsSync(electronBin)) {
  throw new Error(`Electron binary not found at: ${electronBin}`);
}

console.log(`  Electron binary: ${electronBin}`);
console.log(`  Bytenode script: ${bnScript}`);

execSync(
  `"${electronBin}" "${bnScript}" --compile "${bundlePath}"`,
  { cwd: DIST_PACK, stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
);

const jscPath = bundlePath.replace(/\.cjs$/, '.jsc');
if (!fs.existsSync(jscPath)) {
  throw new Error(`Bytecode compilation failed: ${jscPath} not found`);
}
console.log(`  Bytecode: ${path.basename(jscPath)} (${(fs.statSync(jscPath).size / 1024).toFixed(0)} KB)`);

// ─── Step 3: Prepare target directory ─────────────────

console.log('\n[prepare-server] Step 3: Preparing distribution directory...');

cleanDir(TARGET_DIR);
const targetDist = path.join(TARGET_DIR, 'dist');
fs.mkdirSync(targetDist, { recursive: true });

fs.copyFileSync(jscPath, path.join(targetDist, 'index.jsc'));

const loaderContent = `'use strict';
require('bytenode');
require('./index.jsc');
`;
fs.writeFileSync(path.join(targetDist, 'index.js'), loaderContent);

// ─── Step 4: Create package.json and install sharp ────

console.log('\n[prepare-server] Step 4: Installing sharp for distribution...');

const serverPkg = JSON.parse(fs.readFileSync(path.join(SERVER_DIR, 'package.json'), 'utf-8'));
const sharpVersion = serverPkg.dependencies.sharp;

const distPkg = {
  name: 'ai-retouch-server-dist',
  private: true,
  version: '0.0.1',
  dependencies: {
    sharp: sharpVersion,
    bytenode: '*',
  },
};
fs.writeFileSync(path.join(TARGET_DIR, 'package.json'), JSON.stringify(distPkg, null, 2));

run('npm install --prod --no-package-lock', TARGET_DIR);

// ─── Done ─────────────────────────────────────────────

const totalSize = getDirSize(TARGET_DIR);
console.log(`\n[prepare-server] Done! Distribution at: ${TARGET_DIR}`);
console.log(`  Total size: ${(totalSize / 1024 / 1024).toFixed(1)} MB`);

function getDirSize(dir) {
  let size = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      size += getDirSize(fullPath);
    } else {
      size += fs.statSync(fullPath).size;
    }
  }
  return size;
}
