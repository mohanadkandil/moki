# Design: datasheet parse service (Nemotron 3.5 Parse on Modal)

**Decision record:** `docs/adr/0003-datasheet-layout-parsing-nemotron-parse.md`
**Status:** draft for the first slice. Nothing has been built or measured yet.

## 1. Goal

Agents should read datasheet **tables as tables**, and get text from **image-only pages**. Two things must not change:
- every citation is verified by code;
- a build never waits on, or fails because of, this service.

**Non-goals:**
- Replacing pdf.js.
- Reading figures semantically, such as "what does this application circuit show".
- Parsing maker-uploaded documents.

## 2. Today

`src/agents/datasheet.ts`:
1. **Fetch.** The PDF comes from the catalog's LCSC link or an allow-listed maker host. Limits: 30 MB, 3 redirects, and private addresses are refused.
2. **Extract.** pdf.js `getTextContent()` per page, with whitespace collapsed. The result is `Datasheet { url, sha256, pages: string[] }`, cached in `var/datasheets/<sha>.json`.
3. **Agent tools:** search returns `found: [{page, near}]`, and a read returns at most 4 pages and 16,000 characters.
4. **Citation check:** a quote must occur in that page's text.

## 3. Proposed flow

```
PDF (already fetched, sha256 known)
  ├─ pdf.js text (unchanged) ─────────────────────► citation authority
  └─ parse cache hit?  var/datasheets/<sha>.parse.<rev>.json
        └─ miss → POST /parse to Modal (PDF bytes) ─► PageLayout[] → cache
Agent tools: search/read use layout when present, else pdf.js text
```

### Modal service (`infra/modal/parse_app.py`)
- **Image:** vLLM, with the model weights at a **pinned Hugging Face revision** baked into the image or a Modal Volume, so cold starts don't download.
- **GPU:** start with the smallest class that fits, then measure. This is a 0.6B model; we expect an L4-class GPU to be enough. Scale to zero, with an idle timeout of a few minutes.
- **Endpoint:** `POST /parse`, body `{ pdf_base64, max_pages? }`. Inside the container:
  - PyMuPDF renders pages at 150 DPI, capped at 1664 × 2048 as the model card recommends;
  - the model returns layout as JSON.
- **Auth:** a shared secret header, held in a Modal Secret and in the Moki server env. Never in the browser.
- **Limits:**
  - at most 120 pages per request;
  - a 120 s timeout per request, then a split-and-retry.

### Data shape

```ts
interface PageLayout {
  page: number;                        // 1-based, same numbering as pdf.js
  blocks: Array<{
    cls: 'text' | 'title' | 'table' | 'figure' | 'caption' | 'list' | 'other';
    bbox: [number, number, number, number];   // page-normalised 0..1
    text?: string;                     // reading-order text
    table?: string[][];                // rows × cells, when cls = table
  }>;
}
interface ParsedDatasheet { sha256: string; model: 'nvidia/Nemotron-3.5-Parse'; revision: string; pages: PageLayout[]; ms: number }
```

### Agent-facing changes
- **`search`** also matches table cells, and returns `{ page, near, table?: { index, row } }`.
- **New `read_table(part, page, index)`** returns the rows. It is size-capped like page reads.
- **Citations:**
  - A quote must still occur in the pdf.js text for that page. The check normalises whitespace on both sides.
  - The only exception is pages where pdf.js returns under 50 characters. There the quote may match Parse text, and the citation is stored with `source: 'ocr'`. The Reviewer's output lists OCR citations separately.

### Failure behaviour
| Failure | Behaviour |
|---|---|
| Modal down, 5xx or timeout | Log it and use pdf.js only, which is today's behaviour. Retry the parse in the background later. |
| Parse output fails schema validation | Discard it, cache the failure for this hash and revision, and fall back. |
| Parse and pdf.js disagree | pdf.js wins for citations. The disagreement is logged for the evaluation. |

## 4. Security

- **Only public datasheet PDFs are sent,** and only ones already fetched under the existing host rules. No maker briefs, plans or user data.
- **Parse output is untrusted data,** like PDF text today. It never becomes instructions.
- **The secret lives in two places only:** a Modal Secret and the server env file (`/run/user/1000/sogo-apps/moki.env`). It is never committed.

## 5. Evaluation, before adoption

**Datasheets:** RP2040, DRV8833, TPS63001, USBLC6-2SC6 and SHT40. All are already used in our blocks.

**Ground truth, labelled by hand once:**
- each pin table (pin number → name);
- 10 electrical values per part: value, unit and condition.

| Metric | pdf.js | pdfplumber (baseline) | Nemotron Parse | Gate |
|---|---|---|---|---|
| Pin-table rows exact | — | measure | measure | ≥ 98%, and better than pdfplumber |
| Electrical cells exact (value + unit) | — | measure | measure | better than pdfplumber |
| Image-only pages with usable text | 0 of 18 | measure | measure | report |
| Zero-match searches in replayed reviews | 4 of 20 (measured) | — | measure | at most half |
| Review submissions rejected for citations | 5 of 8 (measured) | — | measure | not worse |
| Cold parse, one datasheet (p50/p95) | — | — | measure | report |
| Warm parse, per page | — | — | measure | report |
| Cached read | — | — | measure | < 50 ms |
| GPU cost per datasheet | — | — | measure | report |

**Replayed reviews:** re-run the two recorded RP2040 reviews with parse-backed tools. This costs about $1 in model calls. It is the only part of the evaluation that spends model money.

## 6. Slices

1. **Spike, about 2 hours:**
   - deploy the Modal app;
   - parse the 5 datasheets;
   - record latency and cost;
   - in parallel, run pdfplumber on the same files;
   - score both against the ground truth.
2. **Integrate:**
   - the parse cache and the fallback;
   - `search` over tables, and `read_table`;
   - the OCR citation path, with tests: a schema-invalid response, a timeout, a disagreement, and an OCR quote on a text page being refused.
3. **Replay:** run the review replays and fill in the table above. Set the ADR to Accepted or Rejected based on the numbers.

## 7. Open questions

- **GPU class and cold-start time on Modal:** unknown until the spike.
- **Throughput:** does triple-pass parsing (the model card's best table score) pay off over single-pass at our page counts?
- **Multi-page tables:** should they be merged across pages, or left per page with a continuation flag?
