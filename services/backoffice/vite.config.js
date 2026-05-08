import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,          // 0.0.0.0 (IP du conteneur Docker / ECS)
    port: 5173,
    allowedHosts: true,  // accepte tout hostname (ALB DNS, IP, domaine custom)
    watch: { usePolling: true },
  },
})
