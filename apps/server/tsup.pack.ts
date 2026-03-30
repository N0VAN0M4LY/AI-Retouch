import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  target: 'node18',
  platform: 'node',
  outDir: 'dist-pack',
  clean: true,
  external: ['sharp'],
  noExternal: [/.*/],
  splitting: false,
});
