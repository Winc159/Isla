import { defineConfig } from 'vite';

const host = process.env.ISLA_HOST_URL ?? 'http://127.0.0.1:43110';

export default defineConfig({
  root: 'agent-ui',
  base: '/',
  esbuild: { jsx: 'automatic' },
  server: {
    proxy: Object.fromEntries(['/ui', '/health', '/sessions', '/workspace', '/memory', '/resource', '/mcp', '/capabilities', '/api'].map(path => [path, {
      target: host,
      changeOrigin: true,
      configure(proxy) { proxy.on('proxyReq', request => request.setHeader('origin', host)); },
    }])),
  },
  build: { outDir: '../dist/agent-ui', emptyOutDir: true },
});
