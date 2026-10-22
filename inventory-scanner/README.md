# Store 17 Annual Inventory (Floor Count scanner)

Isolated package for Kane's Store 17 **once-a-year** physical inventory prep. Do not couple to Command Center UI.

## Run locally

```bash
cd inventory-scanner
python3 -m http.server 8765
# open http://127.0.0.1:8765/
npm test   # or: node --test tests/logic.test.mjs tests/inventory-core.test.mjs
```

## Kept from PR #47

- Scan-only UX, Zone → Area → SKU, area tag decode, AS-IS `999999999`, Code 128 zone sheets, embedded ~4,775 catalog, workbook export, zone master.

## Added

- Unit events with immutable IDs; local-first persistence (localStorage + IndexedDB migration; legacy key preserved)
- Sync client + Apps Script (`gas/`) with idempotent `event_id` writes and `SYNC_TOKEN`
- Area status + revision; Zones & Areas print (one barcode per unit)
- Executive Report (4 views; Expected unavailable until import)
- CSV imports (identified + expected) with preview/validate/confirm
- Templates under `templates/`; sample print under `sample-prints/`

## Google Apps Script deploy (Kelly)

1. `clasp login` as the sheet editor account.
2. Create/push project from `gas/` (or paste files into script.google.com).
3. Set `EXISTING_SPREADSHEET_ID` (production or a **TEST COPY**).
4. Run `setupStore` once (creates missing tabs only).
5. Script Properties → `SYNC_TOKEN` = strong secret; `setSyncToken` helper available.
6. Deploy as Web app → execute as Me → copy `/exec` URL into Setup in the scanner.

**Never write test counts into production `INVENTORY_COUNTS`.** Use a TEST COPY spreadsheet id while validating.

## Sheet

Production id: `1j0laH6BDbp35i3DWqs2of_aLJ9XSrDFiy_yEB3rZBxU` (Restricted).
