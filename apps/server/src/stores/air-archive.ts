import fs from 'node:fs';
import path from 'node:path';
import archiver, { type ZipEntryData } from 'archiver';
import yauzl from 'yauzl';

/**
 * Unpack an .air (ZIP) file into the given work directory.
 * Creates workDir if it doesn't exist.
 */
export function unpackAir(airPath: string, workDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(workDir, { recursive: true });

    yauzl.open(airPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err ?? new Error('Failed to open ZIP'));

      zipfile.readEntry();
      zipfile.on('entry', (entry: yauzl.Entry) => {
        const dest = path.join(workDir, entry.fileName);

        if (/\/$/.test(entry.fileName)) {
          fs.mkdirSync(dest, { recursive: true });
          zipfile.readEntry();
        } else {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          zipfile.openReadStream(entry, (err2, readStream) => {
            if (err2 || !readStream) return reject(err2 ?? new Error('Failed to read entry'));
            const writeStream = fs.createWriteStream(dest);
            readStream.on('error', (streamErr) => {
              writeStream.destroy();
              try { fs.unlinkSync(dest); } catch {}
              reject(streamErr);
            });
            writeStream.on('error', reject);
            readStream.pipe(writeStream);
            writeStream.on('close', () => zipfile.readEntry());
          });
        }
      });

      zipfile.on('end', resolve);
      zipfile.on('error', reject);
    });
  });
}

/**
 * Lenient unpack: recover as many entries as possible from a potentially
 * corrupted ZIP. Skips entries whose local file headers are damaged.
 * Returns { recovered, skipped } counts.
 */
export function lenientUnpackAir(
  airPath: string,
  workDir: string,
): Promise<{ recovered: number; skipped: number }> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(workDir, { recursive: true });

    yauzl.open(airPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err ?? new Error('Failed to open ZIP'));

      let recovered = 0;
      let skipped = 0;

      zipfile.readEntry();
      zipfile.on('entry', (entry: yauzl.Entry) => {
        if (/[\x00-\x1f]/.test(entry.fileName) || entry.fileName.includes('\0')) {
          skipped++;
          console.warn(`[AirArchive] Skipping entry with invalid filename (contains control/null bytes)`);
          zipfile.readEntry();
          return;
        }

        try {
          const dest = path.join(workDir, entry.fileName);

          if (/\/$/.test(entry.fileName)) {
            fs.mkdirSync(dest, { recursive: true });
            zipfile.readEntry();
            return;
          }

          fs.mkdirSync(path.dirname(dest), { recursive: true });
          zipfile.openReadStream(entry, (err2, readStream) => {
            if (err2 || !readStream) {
              skipped++;
              console.warn(`[AirArchive] Skipping corrupted entry: ${entry.fileName}`);
              zipfile.readEntry();
              return;
            }
            const writeStream = fs.createWriteStream(dest);
            readStream.on('error', () => {
              skipped++;
              console.warn(`[AirArchive] Read error on entry: ${entry.fileName}`);
              try { writeStream.destroy(); fs.unlinkSync(dest); } catch {}
              zipfile.readEntry();
            });
            writeStream.on('close', () => {
              recovered++;
              zipfile.readEntry();
            });
            writeStream.on('error', () => {
              skipped++;
              try { fs.unlinkSync(dest); } catch {}
              zipfile.readEntry();
            });
            readStream.pipe(writeStream);
          });
        } catch (entryErr) {
          skipped++;
          console.warn(`[AirArchive] Skipping entry due to error:`, entryErr);
          zipfile.readEntry();
        }
      });

      zipfile.on('end', () => resolve({ recovered, skipped }));
      zipfile.on('error', (zipErr) => {
        if (recovered > 0) {
          console.warn(`[AirArchive] ZIP-level error after recovering ${recovered} entries:`, zipErr);
          resolve({ recovered, skipped });
        } else {
          reject(zipErr);
        }
      });
    });
  });
}

/**
 * Validate that a file is a readable ZIP by checking whether yauzl can open it.
 */
export function validateAir(airPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!fs.existsSync(airPath)) return resolve(false);
    const stat = fs.statSync(airPath);
    if (stat.size < 22) return resolve(false); // minimum ZIP size (empty archive)
    yauzl.open(airPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return resolve(false);
      zipfile.close();
      resolve(true);
    });
  });
}

/**
 * Multi-strategy repair for a corrupted .air file.
 * Attempts in order:
 *   1. Use .air.tmp if it exists and is valid
 *   2. Lenient unpack (skip corrupted entries, recover the rest)
 *   3. Fail (caller should create fresh workDir)
 *
 * Returns { strategy, recovered?, skipped? } or throws if nothing worked.
 */
export async function repairAndUnpackAir(
  airPath: string,
  workDir: string,
): Promise<{ strategy: string; recovered?: number; skipped?: number }> {
  const tmpPath = airPath + '.tmp';

  // Strategy 1: .air.tmp fallback
  if (fs.existsSync(tmpPath)) {
    const tmpValid = await validateAir(tmpPath);
    if (tmpValid) {
      console.log(`[AirArchive] Found valid .air.tmp, using it as replacement`);
      const backupPath = airPath + '.corrupted';
      try { fs.renameSync(airPath, backupPath); } catch {}
      fs.renameSync(tmpPath, airPath);
      if (fs.existsSync(workDir)) {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
      await unpackAir(airPath, workDir);
      return { strategy: 'tmp_fallback' };
    } else {
      console.warn(`[AirArchive] .air.tmp exists but is also invalid, removing`);
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  }

  // Strategy 2: Lenient unpack (Central Directory intact, some entries damaged)
  try {
    if (fs.existsSync(workDir)) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
    const { recovered, skipped } = await lenientUnpackAir(airPath, workDir);
    if (recovered > 0) {
      console.log(`[AirArchive] Lenient recovery: ${recovered} entries recovered, ${skipped} skipped`);
      // Ensure manifest exists after recovery
      const manifestPath = path.join(workDir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) {
        fs.writeFileSync(manifestPath, JSON.stringify({
          version: 1,
          createdAt: Date.now(),
          lastModified: Date.now(),
          repaired: true,
        }, null, 2));
      }
      const backupPath = airPath + '.pre-repair';
      try { fs.copyFileSync(airPath, backupPath); } catch {}
      return { strategy: 'lenient_unpack', recovered, skipped };
    }
  } catch (lenientErr) {
    console.warn(`[AirArchive] Lenient unpack also failed:`, lenientErr);
  }

  // All strategies exhausted
  throw new Error('All repair strategies failed');
}

/**
 * Pack a work directory into an .air (ZIP) file.
 * Uses STORE (no compression) for image files, DEFLATE for JSON.
 * Writes to a .tmp file first then renames for atomicity.
 */
export function packAir(workDir: string, airPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tmpPath = airPath + '.tmp';
    const output = fs.createWriteStream(tmpPath);
    const archive = archiver('zip', { zlib: { level: 0 } });

    output.on('close', () => {
      try {
        fs.renameSync(tmpPath, airPath);
        resolve();
      } catch (e) {
        reject(e);
      }
    });

    archive.on('error', (err) => {
      try { fs.unlinkSync(tmpPath); } catch {}
      reject(err);
    });

    archive.pipe(output);

    const imageExts = new Set(['.png', '.jpg', '.jpeg', '.webp']);

    function addDir(dirPath: string, zipPath: string) {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const entryZipPath = zipPath ? `${zipPath}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          addDir(fullPath, entryZipPath);
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          const store = imageExts.has(ext);
          archive.file(fullPath, {
            name: entryZipPath,
            store,
          } as ZipEntryData);
        }
      }
    }

    addDir(workDir, '');
    archive.finalize();
  });
}

/**
 * Compute the .air file path for a given PSD path.
 * Example: C:\Art\MyPhoto.psd → C:\Art\MyPhoto.air
 */
export function airPathForPsd(psdPath: string): string {
  const dir = path.dirname(psdPath);
  const base = path.basename(psdPath, path.extname(psdPath));
  return path.join(dir, `${base}.air`);
}
