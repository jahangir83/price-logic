import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Banner, Page, SkeletonBodyText, SkeletonPage } from '@shopify/polaris';
import { getStoreInitStatus, type StoreInitStatus } from '../api/store-init';
import { ShopContext } from './shop';

/**
 * Fetches the shop once, above the router, so a route change does not re-fetch
 * it. None of it changes while the app is open.
 */
type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; status: StoreInitStatus }
  | { phase: 'failed' };

export function ShopProvider({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [setUpOverride, setSetUpOverride] = useState(false);

  useEffect(() => {
    let cancelled = false;

    getStoreInitStatus()
      .then((status) => {
        if (!cancelled) setState({ phase: 'ready', status });
      })
      .catch(() => {
        // A 401 has already sent the merchant back through OAuth from inside
        // the fetch wrapper, so what reaches here is the backend being
        // unreachable. There is nothing to render around it: every screen below
        // needs a currency, and guessing one would put wrong prices on screen.
        if (!cancelled) setState({ phase: 'failed' });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.phase === 'loading') {
    return (
      <SkeletonPage primaryAction>
        <SkeletonBodyText lines={8} />
      </SkeletonPage>
    );
  }

  if (state.phase === 'failed') {
    return (
      <Page>
        <Banner
          tone="critical"
          title="PriceLogic could not reach its server"
          action={{
            content: 'Try again',
            onAction: () => window.location.reload(),
          }}
        >
          Your prices have not been changed. This is a problem with the app, not
          with your store.
        </Banner>
      </Page>
    );
  }

  const { status } = state;

  return (
    <ShopContext.Provider
      value={{
        currency: status.currency,
        isSetUp: setUpOverride || status.initializationStatus === 'COMPLETE',
        markSetUp: () => setSetUpOverride(true),
      }}
    >
      {children}
    </ShopContext.Provider>
  );
}
