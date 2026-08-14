import type {
  CampaignDto,
  CampaignTargetDto,
  CampaignTargetMode,
  CreateCampaignRequest,
  PaginatedResponse,
  UpdateCampaignRequest,
} from '@pricelogic/shared';
import { apiFetch } from './client';

/** A campaign plus the actions the server says are legal from here. */
export type CampaignDetail = CampaignDto & { allowedTransitions: string[] };

export function listCampaigns(
  params: { status?: string; search?: string; page?: number } = {},
): Promise<PaginatedResponse<CampaignDto>> {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.search) search.set('search', params.search);
  if (params.page) search.set('page', String(params.page));
  const qs = search.toString();
  return apiFetch(`/campaigns${qs ? `?${qs}` : ''}`);
}

export function getCampaign(id: string): Promise<CampaignDetail> {
  return apiFetch(`/campaigns/${id}`);
}

export function createCampaign(
  body: CreateCampaignRequest,
): Promise<CampaignDto> {
  return apiFetch('/campaigns', { method: 'POST', body: JSON.stringify(body) });
}

export function updateCampaign(
  id: string,
  body: UpdateCampaignRequest,
): Promise<CampaignDto> {
  return apiFetch(`/campaigns/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function changeCampaignStatus(
  id: string,
  status: string,
): Promise<CampaignDto> {
  return apiFetch(`/campaigns/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function listTargets(id: string): Promise<{
  targets: CampaignTargetDto[];
  counts: Record<CampaignTargetMode, number>;
}> {
  return apiFetch(`/campaigns/${id}/targets`);
}
