import { defineConfig, Plugin } from 'vite';

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
  plugins: [tauriFix()],
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
