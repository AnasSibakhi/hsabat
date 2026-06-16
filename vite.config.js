import { defineConfig } from 'vite';
import { resolve }      from 'path';

export default defineConfig({
  // جذر المشروع هو نفس مكان index.html
  root: '.',

  // الملفات الـ static (CSS, icons, manifest)
  publicDir: 'public',

  build: {
    outDir:        'dist',
    emptyOutDir:   true,
    // index.html كنقطة دخول
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },

  // لما تشغلي vite dev
  server: {
    port: 3000,
  },
});
