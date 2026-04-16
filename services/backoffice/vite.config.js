import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // Permet d'écouter sur l'IP du conteneur Docker
    allowedHosts: [
      'casino-alb-131591739.eu-west-3.elb.amazonaws.com'
    ]
  }
})
