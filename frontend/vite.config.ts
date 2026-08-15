import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Lets Shopify put the dev server in an iframe.
 *
 * An embedded app must answer with `frame-ancestors` naming the shop that is
 * framing it and the admin; without it the browser refuses to render the frame
 * and the merchant gets a blank panel. Vite's static `server.headers` cannot do
 * this, because the allowed shop differs per request — it is the `shop` query
 * param Shopify appends when it opens the app.
 *
 * In production the same header has to come from whatever serves the built
 * assets. This plugin only covers `vite dev`.
 */
function shopifyFrameAncestors(): Plugin {
  return {
    name: 'shopify-frame-ancestors',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const shop = new URL(
          req.url ?? '/',
          'http://localhost',
        ).searchParams.get('shop');

        const ancestors = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(
          shop ?? '',
        )
          ? `https://${shop} https://admin.shopify.com`
          : 'https://*.myshopify.com https://admin.shopify.com';

        res.setHeader(
          'Content-Security-Policy',
          `frame-ancestors ${ancestors};`,
        );
        next();
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // The public hostname the tunnel serves this dev server on. HMR opens its
  // websocket against the page's origin, so without this it dials
  // `localhost:3000` from inside Shopify's iframe and never connects — the app
  // still runs, but every edit needs a manual reload and the console fills with
  // failed handshakes.
  const tunnelHost = env.VITE_TUNNEL_HOST;

  return {
    server: {
      port: 3000,
      // The tunnel is pinned to this port and the backend owns 3001. Silently
      // falling forward to another port breaks both.
      strictPort: true,
      allowedHosts: [
        'inspiration.shafayet.pro',
        'frontend-j.charming-wood.xyz',
        '.trycloudflare.com',
      ],
      hmr: tunnelHost
        ? { protocol: 'wss', host: tunnelHost, clientPort: 443 }
        : undefined,
    },

    plugins: [react(), shopifyFrameAncestors()],
  };
});
