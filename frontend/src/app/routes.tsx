import type { ReactElement } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Banner, Page } from '@shopify/polaris';
import { CampaignStatus, type CampaignDto } from '@pricelogic/shared';
import { CampaignForm } from '../pages/CampaignForm/CampaignForm';
import { CampaignList } from '../pages/CampaignList/CampaignList';
import { CampaignPreview } from '../pages/CampaignPreview/CampaignPreview';
import { CampaignResults } from '../pages/CampaignResults/CampaignResults';
import { SheetApproval } from '../pages/SheetApproval/SheetApproval';
import { SetupWizard } from '../pages/SetupWizard/SetupWizard';
import { useShop } from './shop';

/**
 * The seam between the router and the screens.
 *
 * Every page below takes plain props — an id, a currency, a callback — and
 * knows nothing about URLs. These adapters are the only place that reads
 * `useParams` or calls `navigate`, which keeps each screen renderable from
 * anywhere and keeps "what the URLs are" a single question with a single
 * answer.
 */

/**
 * A campaign that has not run yet is a plan; one that has is a record. They are
 * different screens, so opening a campaign has to pick.
 */
function campaignPath(campaign: CampaignDto): string {
  const hasRun =
    campaign.status === CampaignStatus.ACTIVE ||
    campaign.status === CampaignStatus.COMPLETED ||
    campaign.status === CampaignStatus.FAILED ||
    campaign.status === CampaignStatus.CANCELLED;
  return hasRun
    ? `/campaigns/${campaign.id}/results`
    : `/campaigns/${campaign.id}`;
}

export function CampaignListRoute(): ReactElement {
  const navigate = useNavigate();
  return (
    <CampaignList
      onOpen={(campaign) => navigate(campaignPath(campaign))}
      onCreate={() => navigate('/campaigns/new')}
    />
  );
}

export function CampaignFormRoute(): ReactElement {
  const navigate = useNavigate();
  const { currency } = useShop();
  return (
    <CampaignForm
      currency={currency}
      // Saved as a draft, so the preview is where the merchant goes next: it is
      // the screen that answers "what will this actually do", which is the
      // question standing between a draft and activating it.
      onSaved={(campaignId) => navigate(`/campaigns/${campaignId}`)}
    />
  );
}

export function CampaignPreviewRoute(): ReactElement {
  const { campaignId } = useParams();
  if (!campaignId) return <BadLink />;
  return <CampaignPreview campaignId={campaignId} />;
}

export function CampaignResultsRoute(): ReactElement {
  const { campaignId } = useParams();
  const { currency } = useShop();
  if (!campaignId) return <BadLink />;
  return <CampaignResults campaignId={campaignId} currency={currency} />;
}

export function SheetApprovalRoute(): ReactElement {
  const { importId } = useParams();
  const navigate = useNavigate();
  const { currency } = useShop();
  if (!importId) return <BadLink />;
  return (
    <SheetApproval
      importId={importId}
      currency={currency}
      onApproved={(campaignId) => navigate(`/campaigns/${campaignId}`)}
    />
  );
}

/**
 * The wizard, or past it.
 *
 * The OAuth callback lands every install here, including a reinstall by a shop
 * that was set up months ago — its settings survived the uninstall, so walking
 * it back through five steps of questions it has already answered would be the
 * app forgetting something it plainly remembers.
 */
export function SetupRoute(): ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const { isSetUp, markSetUp } = useShop();

  if (isSetUp) return <Navigate to="/campaigns" replace />;

  // Where the gate turned them away from, if it did. Router state is the right
  // carrier for it: it is not part of the address, and a merchant who bookmarks
  // the wizard should get the wizard, not somebody else's interrupted journey.
  const from = (location.state as { from?: string } | null)?.from;

  return (
    <SetupWizard
      onFinished={() => {
        // Told locally as well as on the server: the gate below reads this, and
        // re-fetching only to learn what we just wrote would put a spinner
        // between the merchant and the app on the one screen where they have
        // just been told they are finished.
        markSetUp();
        navigate(from ?? '/campaigns', { replace: true });
      }}
    />
  );
}

/**
 * Where an unrecognised URL lands.
 *
 * The setup gate decides between the wizard and the app, so this is one
 * redirect rather than two rules that can disagree.
 */
export function HomeRoute(): ReactElement {
  return <Navigate to="/campaigns" replace />;
}

/** A route that matched but produced no id — a truncated or edited URL. */
function BadLink(): ReactElement {
  return (
    <Page>
      <Banner tone="warning" title="That link is incomplete">
        Open the campaign from the campaigns list instead.
      </Banner>
    </Page>
  );
}
