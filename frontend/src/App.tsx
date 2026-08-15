import type { ReactElement, ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { NavMenu } from './app/NavMenu';
import { ShopProvider } from './app/ShopProvider';
import { useShop } from './app/shop';
import {
  CampaignFormRoute,
  CampaignListRoute,
  CampaignPreviewRoute,
  CampaignResultsRoute,
  HomeRoute,
  SetupRoute,
  SheetApprovalRoute,
} from './app/routes';
import { AuthError } from './pages/AuthError';
import { Pricing } from './pages/Pricing/Pricing';

/**
 * `/auth/error` is deliberately outside everything else. It is the screen the
 * backend redirects to when it could not establish a shop at all, so anything
 * that needs one — the shop fetch, the setup gate, App Bridge — would replace
 * the reason for the failure with a symptom of it.
 */
export function App(): ReactElement {
  return (
    <Routes>
      <Route path="/auth/error" element={<AuthError />} />
      <Route path="/*" element={<EmbeddedApp />} />
    </Routes>
  );
}

function EmbeddedApp(): ReactElement {
  return (
    <ShopProvider>
      <NavMenu />
      <Routes>
        <Route path="/setup" element={<SetupRoute />} />
        <Route
          path="/campaigns"
          element={
            <RequireSetup>
              <CampaignListRoute />
            </RequireSetup>
          }
        />
        <Route
          path="/campaigns/new"
          element={
            <RequireSetup>
              <CampaignFormRoute />
            </RequireSetup>
          }
        />
        <Route
          path="/campaigns/:campaignId"
          element={
            <RequireSetup>
              <CampaignPreviewRoute />
            </RequireSetup>
          }
        />
        <Route
          path="/campaigns/:campaignId/results"
          element={
            <RequireSetup>
              <CampaignResultsRoute />
            </RequireSetup>
          }
        />
        <Route
          path="/imports/:importId"
          element={
            <RequireSetup>
              <SheetApprovalRoute />
            </RequireSetup>
          }
        />
        <Route
          path="/pricing"
          element={
            <RequireSetup>
              <Pricing />
            </RequireSetup>
          }
        />
        <Route path="*" element={<HomeRoute />} />
      </Routes>
    </ShopProvider>
  );
}

/**
 * Keeps a half-configured shop out of the app.
 *
 * The wizard is where a merchant sets the floor prices and margins that stop a
 * campaign selling at a loss. Letting them build one first would mean the
 * protections that exist to catch a mistake are set after the mistake is
 * possible.
 *
 * The current path is carried across so finishing setup can send them back to
 * whatever they were trying to open — a link from an email, a bookmarked
 * campaign — rather than dropping them on the home screen.
 */
function RequireSetup({ children }: { children: ReactNode }): ReactElement {
  const { isSetUp } = useShop();
  const location = useLocation();

  if (!isSetUp) {
    return <Navigate to="/setup" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
