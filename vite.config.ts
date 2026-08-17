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
  // Los console.log/info/debug no llegan al bundle de producción (paso 10).
  //
  // Eran 70 solo de `log` en el bundle publicado, varios imprimiendo datos personales:
  // el email en el reset de contraseña, el id y el rol del usuario, y lo que el cliente
  // teclea en el autocompletado de dirección. Cualquiera con DevTools abierto los veía.
  //
  // `pure` los marca como libres de efectos para que el minificador los elimine, en vez de
  // usar `drop: ['console']`: así se conservan `console.warn` y `console.error`, que son los
  // que avisan de problemas reales. Quedarse ciego ante los errores en producción no es
  // seguridad, es no poder diagnosticar lo que le pase a un cliente. Los flujos de reserva
  // y pago, además, ya reportan al servidor vía `reportBookingEvent`.
  //
  // Ojo: esto NO sustituye a no escribir datos personales en los logs. Es la segunda barrera.
  esbuild: {
    pure: ['console.log', 'console.info', 'console.debug'],
  },
  build: {
    chunkSizeWarningLimit: 1000
  },
  preview: {
    host: true,
    port: 4173,
    strictPort: true
  },
  test: {
    // Los worktrees de agentes viven en `.claude/worktrees/` DENTRO del proyecto, así que sus
    // copias de los tests se descubrían como si fueran nuestras: la suite pasaba de 387 a 743
    // y el número dejaba de significar nada. Se excluyen para que el recuento sea siempre el
    // del proyecto y no dependa de si hay una tarea en marcha.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**'],
  },
});
