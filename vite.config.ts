import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'BrowserUseEffect',
      fileName: (format) => `index.${format === 'es' ? 'js' : format}`
    },
    rollupOptions: {
      external: ['effect', '@effect/platform', 'chrome-remote-interface'],
      output: {
        globals: {
          'effect': 'Effect',
          '@effect/platform': 'Platform',
          'chrome-remote-interface': 'CDP'
        }
      }
    },
    target: 'es2022',
    sourcemap: true
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@browser-use/effect': resolve(__dirname, 'src')
    }
  },
  test: {
    globals: true,
    environment: 'node'
  }
})