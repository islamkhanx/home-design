import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { localRenderPlugin } from './scripts/local-render-plugin.mjs'
export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') }
  return {
    plugins: [vue(), localRenderPlugin(env)],
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  }
})
