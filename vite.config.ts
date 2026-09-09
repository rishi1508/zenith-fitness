import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'fs'

// Read version from package.json
const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: '0.0.0.0',
    port: 5174
  },
  // Vitest: keep agent worktrees under .claude/ out of the run — they carry
  // their own copies of every test file.
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '.claude/**', 'dist/**'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          // Firebase and the icon set never change between app releases; keeping
          // them out of the app chunk means a version bump re-downloads ~450 kB
          // instead of ~1.1 MB on a phone.
          'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/messaging'],
          'vendor-icons': ['lucide-react'],
        }
      }
    }
  }
})
