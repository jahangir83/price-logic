# Supplier and sheet UI

Status: Complete
Completed: 2026-08-16

Phase 5 built suppliers and sheet import end to end — controller, parser,
matcher, approval, job handlers — and marked itself complete. All of it was
backend. Nothing in the admin UI can reach any of it.

The state today: `api/imports.ts` has read, override and approve but **no
upload**. There is no suppliers API in the frontend at all. `SheetApproval`
(316 lines, finished) sits at `/imports/:importId` with nothing linking to it,
so the only way in is to type a UUID into the address bar.

## What has to exist

- [x] **A list endpoint for imports.** `GET /imports` does not exist — the
  controller has upload, findOne, rows and approve. Without it a sheet is
  reachable only by an id the merchant would have had to write down, so
  yesterday's upload is gone. Paginated, newest first, optional supplier
  filter.

- [x] **`api/suppliers.ts`** — list, create, update, remove against the CRUD
  that is already there.

- [x] **`uploadSheet()`** in `api/imports.ts`, plus `listImports()`. The upload
  is multipart; `apiFetch` already leaves `Content-Type` alone for a
  `FormData` body so the boundary survives.

- [x] **A suppliers screen.** Create, rename, deactivate. Small, because a
  supplier here is identity only — a name and an optional code, no costs and
  no integration.

- [x] **An upload screen.** Pick a supplier, choose a file, upload.

- [x] **Wait for the parse.** The endpoint returns as soon as the file is
  stored; parsing and matching are jobs. The screen has to poll `GET /imports/:id`
  until it leaves `PARSING`, and say what is happening while it does — an
  upload that appears to do nothing for thirty seconds reads as a failure, and
  the merchant uploads again.

- [x] **A sheets list**, so an import can be found after the fact, with its
  status and counts, linking to the approval screen.

- [x] **Routes and navigation** for all of it, including the entry point to
  `SheetApproval` that has never existed.

- [x] **Tests** on the list endpoint and its tenant scoping.

## Decisions taken

**Poll rather than stream.** The parse is usually seconds and the app already
polls for campaign progress; a websocket for one screen is a second transport
to operate for no gain.

**Deleting a supplier is a soft delete, and the UI says so.** `csv_imports`
references suppliers and the history has to stay readable — a merchant told
"delete" who then finds the name still on last month's import has been lied to.
