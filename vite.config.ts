import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  server: {
    host: true, // Permite acceso desde otros dispositivos en la red
    port: 5173,
    strictPort: true, // Falla si el puerto está ocupado en lugar de usar otro
    open: false, // No abrir automáticamente el navegador
    cors: true, // Habilitar CORS
    hmr: {
      overlay: false // Desactivar overlay de errores que puede causar problemas
    }
  },
  build: {
    chunkSizeWarningLimit: 1000
  },
  preview: {
    host: true,
    port: 4173,
    strictPort: true
  }
});
