import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv, type Plugin} from 'vite';

// Arama motorları için tazelik sinyali: her derlemede sitemap.xml'in lastmod'u ve index.html'deki JSON-LD
// dateModified derleme gününe ayarlanır (otomatik video güncellemesi de derleme yaptığı için kendiliğinden tazelenir).
function tazelik(): Plugin {
  const gun = new Date().toLocaleDateString('sv-SE', {timeZone: 'Europe/Istanbul'});
  const sayfalar = ['/', '/gizlilik', '/kosullar'];
  return {
    name: 'tazelik',
    transformIndexHtml: (html) => html.replaceAll('__DERLEME_GUNU__', gun),
    generateBundle() {
      const url = sayfalar
        .map((p) => `  <url>\n    <loc>https://12in12.co${p}</loc>\n    <lastmod>${gun}</lastmod>\n  </url>`)
        .join('\n');
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${url}\n</urlset>\n`,
      });
    },
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), tazelik()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    // Ana sayfa + gizlilik ve kullanım koşulları (Google OAuth marka sayfası için). Derleme yapılmadan kökten
    // yayınlansa da aynı adresler çalışır: Netlify /gizlilik isteğine gizlilik.html'i verir.
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          gizlilik: path.resolve(__dirname, 'gizlilik.html'),
          kosullar: path.resolve(__dirname, 'kosullar.html'),
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
