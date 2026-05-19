import { defineConfig, loadEnv } from 'vite';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      // Injects compiled CSS into the IIFE bundle at runtime
      // so hosts only need one <script> tag
      cssInjectedByJsPlugin(),
    ],

    build: {
      lib: {
        entry: 'src/index.js',
        name: 'TOS',
        formats: ['iife'],
        fileName: () => 'tos-frontend.js',
      },
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: mode !== 'production',
      rollupOptions: {
        // No external deps — bundle must be fully self-contained
        external: [],
        output: {
          // Single global: window.TOS
          globals: {},
          inlineDynamicImports: true,
        },
      },
    },

    server: {
      port: 5174,
      proxy: {
        // Proxy all /v1/* calls to Integration Hub during dev
        '/v1': {
          target: env.VITE_API_BASE_URL || 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },

    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./tests/setup.js'],
    },
  };
});
