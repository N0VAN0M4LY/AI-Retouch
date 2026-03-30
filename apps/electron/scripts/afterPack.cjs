/**
 * afterPack hook for electron-builder.
 * Manually applies icon + version metadata via rcedit since signAndEditExecutable
 * is disabled (workaround for winCodeSign symlink extraction failure on Windows
 * without Developer Mode).
 */
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function afterPack(context) {
  if (process.platform !== 'win32') return;

  const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  if (!fs.existsSync(exePath)) return;

  const cacheBase = path.join(
    process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local'),
    'electron-builder', 'Cache', 'winCodeSign',
  );

  let rcedit = null;
  if (fs.existsSync(cacheBase)) {
    for (const entry of fs.readdirSync(cacheBase)) {
      const candidate = path.join(cacheBase, entry, 'rcedit-x64.exe');
      if (fs.existsSync(candidate)) { rcedit = candidate; break; }
    }
  }

  if (!rcedit) {
    console.warn('[afterPack] rcedit-x64.exe not found in winCodeSign cache, skipping');
    return;
  }

  const iconPath = path.resolve(__dirname, '..', 'resources', 'icon.ico');
  const appInfo = context.packager.appInfo;
  const args = [exePath];

  if (fs.existsSync(iconPath)) {
    args.push('--set-icon', iconPath);
  }

  args.push(
    '--set-version-string', 'ProductName', appInfo.productName,
    '--set-version-string', 'FileDescription', appInfo.productName,
    '--set-version-string', 'CompanyName', '',
    '--set-version-string', 'LegalCopyright', appInfo.copyright || '',
    '--set-version-string', 'OriginalFilename', `${appInfo.productFilename}.exe`,
    '--set-product-version', appInfo.version,
    '--set-file-version', appInfo.version,
  );

  console.log(`[afterPack] Applying icon + metadata to ${path.basename(exePath)}`);
  try {
    execFileSync(rcedit, args);
    console.log('[afterPack] Icon and metadata applied successfully');
  } catch (err) {
    console.warn('[afterPack] rcedit failed:', err.message);
  }
};
