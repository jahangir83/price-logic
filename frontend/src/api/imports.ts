import type {
  CampaignDto,
  CsvImportDto,
  CsvRowDto,
  CsvRowSort,
  CsvRowStatus,
  PaginatedResponse,
} from '@pricelogic/shared';
import { apiFetch } from './client';

export function listImports(
  params: { supplierId?: string; page?: number } = {},
): Promise<PaginatedResponse<CsvImportDto>> {
  const search = new URLSearchParams();
  if (params.supplierId) search.set('supplierId', params.supplierId);
  if (params.page) search.set('page', String(params.page));
  const qs = search.toString();
  return apiFetch(`/imports${qs ? `?${qs}` : ''}`);
}

/**
 * Sends the file and returns as soon as it is stored.
 *
 * The import comes back in `UPLOADED`, not `READY` — parsing and matching are
 * jobs, so the caller has to poll `getImport` until it leaves `PARSING`.
 *
 * The body is `FormData` deliberately: `apiFetch` leaves `Content-Type` alone
 * for one, because the browser has to set it itself to include the multipart
 * boundary. Setting it by hand makes the body unparseable at the other end.
 */
export function uploadSheet(
  supplierId: string,
  file: File,
): Promise<CsvImportDto> {
  const body = new FormData();
  body.append('supplierId', supplierId);
  body.append('file', file);
  return apiFetch('/imports', { method: 'POST', body });
}

export function getImport(id: string): Promise<CsvImportDto> {
  return apiFetch(`/imports/${id}`);
}

export function listImportRows(
  id: string,
  params: {
    status?: CsvRowStatus;
    sort?: CsvRowSort;
    problemsOnly?: boolean;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<PaginatedResponse<CsvRowDto>> {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.sort) search.set('sort', params.sort);
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
