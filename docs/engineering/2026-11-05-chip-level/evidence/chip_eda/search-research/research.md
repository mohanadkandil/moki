# Generic part-search fallback — measured 5 November 2026

**A usable anonymous JLCPCB keyword API was verified for sensors, microphones and amplifiers.** This is public network research only: no production/code/package changes, heavy builds or model calls. Raw bodies and request receipts are retained in this directory; `summary.json` contains extracts linked to their original response files.

## Working fallback

```http
POST https://jlcpcb.com/api/overseas-pcb-order/v1/shoppingCart/smtGood/selectSmtComponentList
User-Agent: Mozilla/5.0
Accept: application/json
Content-Type: application/json

{"keyword":"SHT40","currentPage":1,"pageSize":8}
```

No cookies, Authorization or API key were supplied. Five POST requests, including both microphone spellings and a second sensor page, returned **HTTP 200, application `code: 200`**, with results at `data.componentPageInfo.list`. Pagination fields include `total`, `pageNum`, `pageSize` and `hasNextPage`. Sensor pages 1 and 2 each contained eight results, reported page numbers 1 and 2 and had no overlapping component codes. This demonstrates pagination, not a complete 25-result sensor snapshot.

| Request keyword | Results reported/returned | Observed real catalog candidates |
| --- | --- | --- |
| SHT40, page 1 | 25 total / 8 returned | Sensirion SHT40-AD1B-R2 **C2909890**; SHT40-AD1B-R3 **C2848306** |
| ICS43434 | 6 / 6 | TDK InvenSense ICS-43434 **C5656610**, LGA-6(3.5×2.7) |
| ICS-43434 | 4 / 4 | Same TDK candidate; punctuation changes the broader result set |
| MAX98357A | 6 / 6 | ADI/Maxim MAX98357AETE+T **C910544**, TQFN-16-EP(3×3); MAX98357AEWL+T **C2682619**, BGA-9(1.3×1.3) |

Every component number above came from the retained API response, never model memory. These are discovery candidates, not independently reviewed pinouts or approved substitutes.

## Proposed normalization and fail-closed behavior

Useful fields actually present in the primary JLC response:

| Normalized field | Response field |
| --- | --- |
| Supplier number | `componentCode` |
| MPN | `componentModelEn` |
| Manufacturer | `componentBrandEn` |
| Package | `componentSpecificationEn` |
| Description/category | `describe`, `componentTypeEn` |
| Stock snapshot | `stockCount` |
| Purchasable flag | `isBuyComponent` (string) |
| Datasheet | `dataManualUrl`, optional `dataManualOfficialLink` |
| Catalog link | optional `lcscGoodsUrl`; also `urlSuffix` |
| Price breaks | `componentPrices` (quantity intervals) |

**Never select the first hit automatically.** In the amplifier query, zero-stock “JLCPCB Assembly” entries appear before real manufacturer ICs; the first is a through-hole module, not the requested chip. Preserve manufacturer/package identity and require importer and manufacturer-datasheet validation. `isBuyComponent: "0"` and zero stock are present for those first two assembly entries; normal real candidates can have `"1"`. Do not infer purchasability from a syntactically valid C-number alone. Keep unreviewed lifecycle state until the independent promotion gate passes.

Treat HTTP failure, invalid JSON, missing page/list shape or non-success application code as **search unavailable**, not “no matching parts.” A valid empty list is a separate result. Preserve source endpoint, query/page, capture time and raw response/hash. Retry or use a bounded fallback; do not fabricate catalog rows. This is an observed website API, not a versioned stability/SLA guarantee. Cache discovery with a bounded age and revalidate exact supplier identity/availability before assembly export; stock is a capture-time snapshot.

## jlcsearch status and failure evidence

The [primary tscircuit API documentation](https://github.com/tscircuit/docs/blob/main/docs/web-apis/jlcsearch-api.md) describes both generic endpoints. In this research:

- `GET https://jlcsearch.tscircuit.com/api/search?q=SHT40&limit=8` returned HTTP 200 and eight rows. The coordinator had observed earlier 500s, so this is a later success, not a denial of the earlier outage.
- `GET https://jlcsearch.tscircuit.com/components/list.json?search=SHT40&limit=8` returned HTTP 500. The retained body says `D1 query failed` and explicitly reports database overload within a ten-second resource window. This supports an upstream capacity failure rather than inventing a client-side parameter fix.
- `GET https://jlcsearch.tscircuit.com/categories/list.json` returned HTTP 200. No category-list workaround is required for the three requested classes because the generic primary JLC POST works.

Retained examples: `jlc-post-sht40.response`, `jlc-post-sht40-page2.response`, `jlc-post-ics43434.response`, `jlc-post-ics-43434.response`, `jlc-post-max98357a.response`, `search-sht40.response`, `list-sht40.response`, each with a matching `*.receipt.json`. Receipts contain method, URL, body, headers, UTC capture time, HTTP status, response size and SHA-256. No catalog/importer/parts implementation was changed by this research.
