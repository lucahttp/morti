import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  base: '/morti/',
  plugins: [
    tailwindcss(),
    react(),
    viteStaticCopy({
      targets: [
        {
          src: [
            'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',
            'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs',
            'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm',
            'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs'
          ],
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
  },
  optimizeDeps: {
    entries: ['index.html', 'src/**/*.html']
  }
})
