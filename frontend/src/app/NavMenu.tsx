import type { MouseEvent, ReactElement } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * The app's navigation, rendered by Shopify rather than by us.
 *
 * `ui-nav-menu` is an App Bridge web component: the admin reads the links out
 * of it and draws them in its own sidebar, outside our iframe. That is why this
 * is not a Polaris `Frame` — an embedded app that draws its own sidebar ends up
 * with two, one of which is a fake.
 *
 * Clicking a link in the admin's sidebar makes App Bridge dispatch a click on
 * the matching anchor in here, which is what lets `onClick` below turn it into
 * a router navigation instead of a full page load. The `href` is a real one, so
 * if that mechanism ever fails the link still goes to the right place — slower,
 * not broken. It survives the reload because `readShopParams` mirrors `shop`
 * and `host` into sessionStorage on the way past.
 *
 * The first link is the app's home and Shopify requires it to be marked as
 * such; its label is ignored in favour of the app's name.
 *
 * Settings is a real destination now rather than a wizard step, so it earns a
 * permanent place here — as does the FAQ, which the setup guide sends merchants
 * to and which they should be able to find again afterwards.
 */
const LINKS: { to: string; label: string }[] = [
  { to: '/', label: 'Home' },
  { to: '/campaigns', label: 'Campaigns' },
  { to: '/sheets', label: 'Price sheets' },
  { to: '/suppliers', label: 'Suppliers' },
  { to: '/pricing', label: 'Plan and usage' },
  { to: '/settings', label: 'Settings' },
  { to: '/faq', label: 'How it works' },
];

export function NavMenu(): ReactElement {
  const navigate = useNavigate();
  const location = useLocation();

  function handleClick(event: MouseEvent<HTMLAnchorElement>, to: string): void {
    // Let the browser have the clicks that mean "somewhere else": a modified
    // click is the merchant asking for a new tab, and taking that over would
    // be a worse app than one with no router at all.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    if (to !== location.pathname) navigate(to);
  }

  return (
    <ui-nav-menu>
      {LINKS.map((link, index) => (
        <a
          key={link.to}
          href={link.to}
          rel={index === 0 ? 'home' : undefined}
          onClick={(event) => handleClick(event, link.to)}
        >
          {link.label}
        </a>
      ))}
    </ui-nav-menu>
  );
}

declare global {
  // Adding to the global JSX namespace is the only way to teach TypeScript
  // about a custom element, and a namespace is the only syntax that does it.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      /**
       * Defined by the App Bridge script, which is loaded from Shopify's CDN
       * rather than bundled — so there is no package to take this type from.
       * Outside the admin it stays undefined, and `index.css` hides it, because
       * an undefined custom element renders its children as bare unstyled links
       * on top of a Polaris page.
       */
      'ui-nav-menu': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}
