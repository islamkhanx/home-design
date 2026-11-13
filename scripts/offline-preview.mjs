import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { projectRoot } from './blender-runtime.mjs'
const out = path.join(projectRoot, '.artifacts/offline')
await build({
  configFile: false,
  root: projectRoot,
  plugins: [vue()],
  base: './',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: out,
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: path.join(projectRoot, 'src/main.ts'),
      name: 'HomeDesign',
      formats: ['iife'],
      fileName: () => 'viewer.js',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
    chunkSizeWarningLimit: 3000,
  },
})
const js = await readFile(path.join(out, 'viewer.js'), 'utf8'),
  css = await readFile(path.join(out, 'home-design.css'), 'utf8')
await writeFile(
  path.join(out, 'home-design-preview.html'),
  '<!doctype html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Home Design · Просмотр</title><style>' +
    css +
    '</style></head><body><div id="app"></div><script>' +
    js.replaceAll('</script', '<\\/script') +
    '</script></body></html>',
)
console.log(path.join(out, 'home-design-preview.html'))
