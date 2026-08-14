import type {
  CampaignDto,
  CsvImportDto,
  CsvRowDto,
  CsvRowStatus,
  PaginatedResponse,
} from '@pricelogic/shared';
import { apiFetch } from './client';

export function getImport(id: string): Promise<CsvImportDto> {
  return apiFetch(`/imports/${id}`);
}

export function listImportRows(
  id: string,
  params: {
    status?: CsvRowStatus;
    problemsOnly?: boolean;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<PaginatedResponse<CsvRowDto>> {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.problemsOnly) search.set('problemsOnly', 'true');
  if (params.page) search.set('page', String(params.page));
  if (params.pageSize) search.set('pageSize', String(params.pageSize));
  const qs = search.toString();
  return apiFetch(`/imports/${id}/rows${qs ? `?${qs}` : ''}`);
}

export function overrideImportRow(
  importId: string,
  rowId: string,
  body: { approvedPrice?: string; excluded?: boolean },
): Promise<CsvRowDto> {
  return apiFetch(`/imports/${importId}/rows/${rowId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function approveImport(
  importId: string,
  body: { title?: string } = {},
): Promise<CampaignDto> {
  return apiFetch(`/imports/${importId}/approve`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
