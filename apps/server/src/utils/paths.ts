import path from 'node:path';

let _dataDir: string | null = null;

export function getDataDir(): string {
  if (_dataDir) return _dataDir;
  _dataDir = process.env.AI_RETOUCH_DATA_DIR || path.resolve(process.cwd(), 'data');
  return _dataDir;
}
