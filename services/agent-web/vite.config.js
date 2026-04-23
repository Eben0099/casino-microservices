import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/agents/pos/', // Indispensable car servi sous /agents/pos par Traefik
  server: {
    host: true,
    port: 5173,
    watch: {
      usePolling: true
    }
  }
})
