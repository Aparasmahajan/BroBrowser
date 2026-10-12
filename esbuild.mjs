// Build script: bundles the three Electron targets with esbuild.
//   main    → dist/main/index.js       (Node context, electron external)
//   preload → dist/preload/bridge.js   (Node context, electron external)
//   ui      → dist/ui/index.js         (browser context) + copied html/css
import { build, context } from 'esbuild';
import { cp, mkdir, readdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const watch = process.argv.includes('--watch');
const dev = watch || process.argv.includes('--dev');

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  sourcemap: dev,
  minify: !dev,
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production') },
};

const targets = [
  {
    ...common,
    entryPoints: { index: 'src/main/index.ts' },
    outdir: 'dist/main',
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    // These packages resolve their own preload paths via require.resolve() /
    // createRequire() at load time, which only works when required from
    // node_modules — so keep them external (never bundled).
    external: [
      'electron',
      'electron-updater',
      '@ghostery/*',
      'electron-chrome-extensions',
      'electron-chrome-extensions/*',
      'electron-chrome-web-store',
      'electron-chrome-web-store/*',
      'electron-chrome-context-menu',
    ],
  },
  {
    ...common,
    entryPoints: { bridge: 'src/preload/bridge.ts', chrome: 'src/preload/chrome.ts', youtube: 'src/preload/youtube.ts' },
    outdir: 'dist/preload',
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['electron', 'electron-chrome-extensions', 'electron-chrome-extensions/*'],
  },
  {
    ...common,
    entryPoints: { index: 'src/ui/index.ts', settings: 'src/ui/settings.ts', library: 'src/ui/library.ts' },
    outdir: 'dist/ui',
    platform: 'browser',
    format: 'iife',
    target: 'chrome120',
  },
];

async function copyStatic() {
  await mkdir('dist/ui', { recursive: true });
  // Copy every static asset (.html/.css) from src/ui verbatim.
  for (const name of await readdir('src/ui')) {
    if (name.endsWith('.html') || name.endsWith('.css')) {
      const dest = `dist/ui/${name}`;
      await mkdir(dirname(dest), { recursive: true });
      await cp(`src/ui/${name}`, dest);
    }
  }
}

if (watch) {
  const ctxs = await Promise.all(targets.map((t) => context(t)));
  await Promise.all(ctxs.map((c) => c.watch()));
  await copyStatic();
  console.log('[esbuild] watching…');
} else {
  await Promise.all(targets.map((t) => build(t)));
  await copyStatic();
  console.log('[esbuild] build complete');
}
