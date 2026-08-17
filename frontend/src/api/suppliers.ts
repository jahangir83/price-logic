import type {
  PaginatedResponse,
  SupplierDto,
  SupplierStatus,
} from '@pricelogic/shared';
import { apiFetch } from './client';

export function listSuppliers(
  params: { status?: SupplierStatus; search?: string; page?: number } = {},
): Promise<PaginatedResponse<SupplierDto>> {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.search) search.set('search', params.search);
  if (params.page) search.set('page', String(params.page));
  const qs = search.toString();
  return apiFetch(`/suppliers${qs ? `?${qs}` : ''}`);
}

export function createSupplier(body: {
  name: string;
  code?: string | null;
}): Promise<SupplierDto> {
  return apiFetch('/suppliers', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateSupplier(
  id: string,
  body: { name?: string; code?: string | null; status?: SupplierStatus },
): Promise<SupplierDto> {
  return apiFetch(`/suppliers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/**
 * A soft delete. The supplier stays on every sheet it ever sent, because
 * `csv_imports` references it and a history that loses the sender's name is
 * not a history.
 */
export function removeSupplier(id: string): Promise<void> {
  return apiFetch(`/suppliers/${id}`, { method: 'DELETE' });
}
