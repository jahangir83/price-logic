import type { ReactElement } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Banner, Page } from '@shopify/polaris';
import { CampaignStatus, type CampaignDto } from '@pricelogic/shared';
import { CampaignForm } from '../pages/CampaignForm/CampaignForm';
import { CampaignList } from '../pages/CampaignList/CampaignList';
import { CampaignPreview } from '../pages/CampaignPreview/CampaignPreview';
import { CampaignResults } from '../pages/CampaignResults/CampaignResults';
import { SheetApproval } from '../pages/SheetApproval/SheetApproval';
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
  const [params] = useSearchParams();
  const copyFromId = params.get('from') ?? undefined;
  return (
    <CampaignForm
      key={copyFromId ?? 'new'}
      copyFromId={copyFromId}
      currency={currency}
      // A new campaign has no id until it is saved, so saving is also the
      // moment it becomes something that can be previewed and activated —
      // which is what the editor at `/campaigns/:id` offers.
      onSaved={(campaignId) => navigate(`/campaigns/${campaignId}`)}
    />
  );
}

/**
 * Opening a saved campaign.
 *
 * The same component as `/campaigns/new`: a draft the merchant is still
 * building and one they opened a day later are the same thing, and splitting
 * them into a builder and a read-only detail page is what left the app with no
 * way to change a campaign after saving it.
 */
export function CampaignEditRoute(): ReactElement {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const { currency } = useShop();
  if (!campaignId) return <BadLink />;
  return (
    <CampaignForm
      key={campaignId}
      campaignId={campaignId}
      currency={currency}
      onDuplicate={(id) => navigate(`/campaigns/new?from=${id}`)}
      onViewResults={(id) => navigate(`/campaigns/${id}/results`)}
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
  const navigate = useNavigate();
  const { currency } = useShop();
  if (!campaignId) return <BadLink />;
  return (
    <CampaignResults
      campaignId={campaignId}
      currency={currency}
      onOpenCampaign={(id) => navigate(`/campaigns/${id}`)}
    />
  );
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
