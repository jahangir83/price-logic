import type { ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { NavMenu } from './app/NavMenu';
import { ShopProvider } from './app/ShopProvider';
import {
  CampaignEditRoute,
  CampaignFormRoute,
  CampaignListRoute,
  CampaignPreviewRoute,
  CampaignResultsRoute,
  SheetApprovalRoute,
} from './app/routes';
import { AuthError } from './pages/AuthError';
import { Faq } from './pages/Faq/Faq';
import { Home } from './pages/Home/Home';
import { Pricing } from './pages/Pricing/Pricing';
import { Settings } from './pages/Settings/Settings';
import { SheetList } from './pages/Sheets/SheetList';
import { SheetUpload } from './pages/Sheets/SheetUpload';
import { Suppliers } from './pages/Suppliers/Suppliers';

/**
 * `/auth/error` is deliberately outside everything else. It is the screen the
 * backend redirects to when it could not establish a shop at all, so anything
 * that needs one — the shop fetch, App Bridge — would replace the reason for
 * the failure with a symptom of it.
 */
export function App(): ReactElement {
  return (
    <Routes>
      <Route path="/auth/error" element={<AuthError />} />
      <Route path="/*" element={<EmbeddedApp />} />
    </Routes>
  );
}

/**
 * Every route below is reachable from the moment the app is installed.
 *
 * There is no setup gate. A shop is given its defaults when its row is created,
 * so there is nothing the merchant must answer before the app works — and a
 * checklist that blocks the product it is introducing is not onboarding.
 */
function EmbeddedApp(): ReactElement {
  return (
    <ShopProvider>
      <NavMenu />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/campaigns" element={<CampaignListRoute />} />
        <Route path="/campaigns/new" element={<CampaignFormRoute />} />
        {/*
          Opening a campaign lands on the editor, not a read-only view: the
          preview it used to show is now a modal inside it, so "what will this
          do" no longer costs the merchant their place in the form.
        */}
        <Route path="/campaigns/:campaignId" element={<CampaignEditRoute />} />
        <Route
          path="/campaigns/:campaignId/preview"
          element={<CampaignPreviewRoute />}
        />
        <Route
          path="/campaigns/:campaignId/results"
          element={<CampaignResultsRoute />}
        />
        <Route path="/sheets" element={<SheetList />} />
        <Route path="/sheets/new" element={<SheetUpload />} />
        <Route path="/suppliers" element={<Suppliers />} />
        {/*
          The approval screen. It has existed since Phase 5 and until now
          nothing linked to it — the sheets list above is its front door.
        */}
        <Route path="/imports/:importId" element={<SheetApprovalRoute />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/faq" element={<Faq />} />

        {/*
          The OAuth callback still lands every install on /setup, so the route
          has to keep answering — it just has nothing left to ask. Replacing
          rather than pushing, so Back does not lead to a redirect.
        */}
        <Route path="/setup" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ShopProvider>
  );
}
