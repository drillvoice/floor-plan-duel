import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

// The service worker (src/sw.js), given the list of files this build made
// and a version from their contents, so each deploy caches itself and
// clears out the last one.
function serviceWorker(): Plugin {
  return {
    name: 'service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = ['manifest.webmanifest', 'icon.svg', ...Object.keys(bundle).filter((f) => f !== 'index.html')].sort();
      const hash = createHash('sha256');
      for (const f of ['manifest.webmanifest', 'icon.svg']) hash.update(readFileSync(`public/${f}`));
      for (const f of files) hash.update(f);
      const source = readFileSync('src/sw.js', 'utf8');
      hash.update(source);
      const build = hash.digest('hex').slice(0, 12);
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `const BUILD = '${build}';\nconst FILES = ${JSON.stringify(files.map((f) => `./${f}`))};\n\n${source}`,
      });
    },
  };
}

export default defineConfig({
  // Relative paths so the build works from any folder, e.g. GitHub Pages.
  base: './',
  plugins: [serviceWorker()],
});
