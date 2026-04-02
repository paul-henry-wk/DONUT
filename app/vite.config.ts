import { defineConfig, Plugin } from 'vite';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';

// Concatenate CSS @imports into a single file for Tauri compatibility.
// Tauri's custom protocol doesn't reliably resolve CSS @import url() chains.
// Source files stay split in public/css/ for maintainability.
function concatCss(): Plugin {
  return {
    name: 'concat-css',
    enforce: 'post',
    writeBundle() {
      const distDir = resolve(__dirname, 'dist');
      const stylePath = join(distDir, 'style.css');
      if (!existsSync(stylePath)) return;
      const root = readFileSync(stylePath, 'utf-8');
      const merged = root.replace(/@import\s+url\(['"]?([^'")\s]+)['"]?\)\s*;?/g, (_match, url) => {
        const filePath = join(distDir, url);
        if (existsSync(filePath)) {
          return `/* ── ${url} ── */\n` + readFileSync(filePath, 'utf-8') + '\n';
        }
        return _match; // keep original if file not found
      });
      // Fix font paths: css/base.css references ../fonts/ but the merged file is at dist root
      const fixed = merged.replace(/url\(['"]?\.\.\/fonts\//g, "url('fonts/");
      writeFileSync(stylePath, fixed);
    },
  };
}

// Fix for Tauri webview: remove type="module" and crossorigin from script tags.
// Tauri's custom protocol (tauri://) has issues with ES module loading.
// Output IIFE format and load as classic script instead.
function tauriFix(): Plugin {
  return {
    name: 'tauri-fix',
    enforce: 'post',
    transformIndexHtml(html) {
      // Remove module/crossorigin attributes and move script to end of body
      let result = html.replace(/ crossorigin/g, '').replace(/ type="module"/g, '');
      // Move <script> from <head> to end of <body>
      const scriptMatch = result.match(/<script\s+src="[^"]+"><\/script>/);
      if (scriptMatch) {
        result = result.replace(scriptMatch[0], '');
        result = result.replace('</body>', scriptMatch[0] + '\n</body>');
      }
      return result;
    },
  };
}

export default defineConfig({
  root: '.',
  base: './',
  plugins: [tauriFix(), concatCss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2021',
    minify: 'esbuild',
    sourcemap: false,
    modulePreload: false,
    rollupOptions: {
      output: {
        format: 'iife',
        entryFileNames: 'assets/app.js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
