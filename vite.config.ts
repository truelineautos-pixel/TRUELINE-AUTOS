import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      workbox: {
        globIgnores: [
          '**/SalesExpenseChart-*.js',
          '**/ReportsCenter-*.js',
          '**/jspdf*.js',
          '**/jspdf.plugin.*.js',
          '**/html2canvas-*.js',
          '**/purify.es-*.js',
          '**/index.es-*.js',
        ],
      },
      manifest: {
        name: 'TrueLine Autos',
        short_name: 'TrueLine',
        description: 'Luxury showroom management system',
        theme_color: '#0f172a',
        background_color: '#020817',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react-vendor',
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 10,
            },
            {
              name: 'supabase-vendor',
              test: /node_modules[\\/]@supabase[\\/]/,
              priority: 5,
            },
          ],
        },
      },
    },
  },
});
