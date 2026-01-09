import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: ['node_modules/onnxruntime-web/dist/*.wasm', 'node_modules/onnxruntime-web/dist/*.mjs'],
          dest: '.'
        }
      ]
    })
  ],
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    }
  },
  build: {
    rollupOptions: {
      external: ['legacy/**']
    }
  }
})
