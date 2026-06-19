import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  build: {
    emptyOutDir: false
  },
  server: {
    host: '0.0.0.0',
    port: 9826,
    watch: {
      ignored: ['**/.omo/evidence/**', '**/test-results/**']
    }
  },
  preview: {
    host: '0.0.0.0',
    port: 9826
  }
})
