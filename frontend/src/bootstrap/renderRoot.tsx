import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppProvider } from '@shopify/polaris';
import polarisEn from '@shopify/polaris/locales/en.json';
import '@shopify/polaris/build/esm/styles.css';
import '../index.css';
import { App } from '../App';

/**
 * Mounts React.
 *
 * Called only once the boot gate has decided this shop is installed and App
 * Bridge is on the page — components may assume `window.shopify` exists.
 */
export function renderRoot(): void {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('Root element #root not found');
  }

  createRoot(rootElement).render(
    <StrictMode>
      <AppProvider i18n={polarisEn}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AppProvider>
    </StrictMode>,
  );
}

/**
 * The one screen that renders without React.
 *
 * Reached when the app is opened outside Shopify — a bookmarked URL, someone
 * typing the tunnel address — so there is no shop to boot for. Kept as plain
 * DOM because mounting the app to explain that the app cannot mount is the
 * wrong shape, and because it must work even if the bundle is otherwise broken.
 */
export function renderMissingShop(): void {
  const rootElement = document.getElementById('root');
  if (!rootElement) return;

  rootElement.innerHTML = `
    <main style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1.5rem; color: #202223; line-height: 1.5;">
      <h1 style="font-size: 1.25rem; margin: 0 0 0.5rem;">Open PriceLogic from your Shopify admin</h1>
      <p style="margin: 0; color: #6d7175;">
        This page needs to know which store it is for. Go to
        <strong>Apps</strong> in your Shopify admin and open PriceLogic from
        there.
      </p>
    </main>
  `;
}
