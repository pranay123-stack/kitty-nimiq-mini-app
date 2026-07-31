import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    // The Mini App loads inside a WebView on mobile data. Keep the entry small
    // and let the browser fetch the rest; this is the single biggest lever on
    // perceived load time.
    target: 'es2020',
    cssCodeSplit: false,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  server: {
    port: 5173,
    // `npm run dev:api` runs the Worker on 8787; proxy so the SPA talks to a
    // real D1-backed API in development instead of mocks.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
})
