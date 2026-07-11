import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    // tronweb expects a Node-style `global` in some code paths when bundled
    // for the browser — map it to `window` so the build doesn't choke.
    global: 'window',
  },
  build: {
    target: 'es2020',
  },
});
