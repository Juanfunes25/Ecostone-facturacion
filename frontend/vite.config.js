import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Fecha del build: se muestra en la app para saber qué versión tiene cada caja.
  define: { __VERSION__: JSON.stringify(new Date().toISOString()) },
  plugins: [
    react(),
    VitePWA({
      // El service worker nuevo se activa apenas se descarga (skipWaiting)
      // y el registro es manual (src/lib/actualizacion.js): la app recarga
      // sola cuando no hay una venta en curso. Antes las cajas se quedaban
      // días con la versión vieja en caché (así apareció el cierre viejo
      // con propinas y descuentos).
      registerType: 'autoUpdate',
      injectRegister: false,
      workbox: {
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        navigateFallbackDenylist: [/^\/api\//],
      },
      manifest: {
        name: 'EcoStone Facturación',
        short_name: 'Facturación',
        theme_color: '#4f6b3c',
        background_color: '#f4f1ea',
        display: 'standalone',
        icons: [],
      },
    }),
  ],
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:4200',
    },
  },
});
