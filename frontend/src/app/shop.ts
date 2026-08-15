import { createContext, useContext } from 'react';

/**
 * The shop facts every screen needs.
 *
 * Currency is the reason this exists. Six screens render money and all of them
 * defaulted to USD, which is silently wrong for every shop that does not trade
 * in it — and wrong in the worst way, since a number formatted with the wrong
 * symbol still looks like a number. It is fetched rather than assumed, and from
 * the shop record rather than the browser's locale, because the currency is a
 * property of the shop and not of whoever is looking at it.
 *
 * Split from the provider so this file exports no components: a module that
 * mixes the two loses React Fast Refresh for everything that imports it.
 */
export interface ShopContextValue {
  currency: string;
  /** Whether the merchant has been through the setup wizard. */
  isSetUp: boolean;
  /** Lets the wizard flip the gate without a second round trip. */
  markSetUp: () => void;
}

export const ShopContext = createContext<ShopContextValue | null>(null);

export function useShop(): ShopContextValue {
  const value = useContext(ShopContext);
  if (!value) {
    throw new Error('useShop must be used inside <ShopProvider>');
  }
  return value;
}
