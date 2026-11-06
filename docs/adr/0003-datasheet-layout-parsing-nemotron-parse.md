# ADR 0003: Layout-aware datasheet parsing with Nemotron 3.5 Parse on Modal

- **Status:** Proposed. Adoption depends on the evaluation in the design doc.
- **Date:** 2026-11-06
- **Deciders:** Mohanad Kandil
- **Design doc:** `docs/engineering/2026-11-06-datasheet-parse/DESIGN.md`

## Context

Chip-level boards depend on datasheets. The Block Author reads them to write blocks, and the Reviewer reads them to check the schematic. Every quote the Reviewer cites is checked by code against the page text (`src/agents/datasheet.ts`).

Today the page text comes from **pdf.js `getTextContent()`**: plain text per page, with whitespace collapsed. Tables lose their rows and columns, and figures are invisible.

**Measured on this repo, 6 Nov 2026:**

| Signal | Value | Source |
|---|---|---|
| Datasheet searches returning 0 matches | 4 of 20 (20%) | The two live RP2040 runs |
| Review submissions rejected by the citation and coverage check | 5 of 8, before the accepted one | Same runs |
| Cached datasheets | 63 PDFs, 1,374 pages, about 1,750 characters per page | `var/datasheets` |
| Pages with under 50 characters of text, likely image-only | 18 of 1,374 (1.3%) | Same |

**What is not proven:** that text extraction causes these misses and rejections. A search can also miss because the model asked badly. The evaluation has to separate the two.

**Where it hurts:**
- **Pin tables.** An RP2040 QFN-56 pin table becomes a run of numbers and names.
- **Electrical-characteristics tables.** Value, unit and condition lose their columns.
- **Pinout and application figures.** pdf.js returns nothing for these.

## Decision

1. **Add a parse stage** that runs NVIDIA **Nemotron 3.5 Parse** on each datasheet once. Its output is cached by `sha256(pdf) + model revision`, and agents get structured pages: text blocks in reading order, tables as rows, and figure regions with bounding boxes.
2. **pdf.js text stays the authority for citations.** A quote is accepted only if it appears in the pdf.js text for that page. Parse output helps the agents find and read; it is not evidence. The one exception: pages where pdf.js returns under 50 characters may be cited from Parse text. Those citations are labelled `ocr`, and the review marks them as lower trust.
3. **Host it on Modal** as a GPU function that scales to zero, serving the model with vLLM. The Hugging Face revision is pinned. The Moki server calls it over HTTPS with a shared secret, and only public datasheet PDFs are sent. No maker data leaves the server.
4. **Never block a build.** If the parse service is slow or down, agents fall back to today's pdf.js text, and the build continues.

## Why Nemotron 3.5 Parse

**What the model card says:**
- 0.631B parameters.
- Outputs text, layout classes, bounding boxes and reading order, as Markdown, HTML or JSON. Tables can come out as CSV, LaTeX or JSON.
- License: OpenMDW 1.1, commercial use allowed.
- vLLM serving is supported.
- Reported scores: 84.67 on ParseBench tables (triple pass) and 18 pages/s on one H200.

**Why it fits:**
- **Small.** A 0.6B model should fit a single small GPU. That's an assumption until measured on Modal.
- **It produces structure, not prose.** That matches how the pipeline works: code checks whatever the model produces.
- **We parse once and reuse.** A datasheet is parsed once for every project that uses the part, so the GPU cost is per part, not per build.

## Alternatives

| Option | Why not, or why it isn't decided yet |
|---|---|
| **Status quo: pdf.js text only** | Free, but tables lose structure and figures are missing. It stays as the fallback and the citation authority. |
| **CPU table extraction (pdfplumber or Camelot)** | No GPU, and strong on vector PDFs. It fails on scanned or image pages and gives no reading order. **It is a real contender and goes into the evaluation as the baseline to beat.** |
| **Send page images to the reasoning model** | Pays the vision cost on every read and leaves nothing structured to cache. Possible later for figures only. |
| **Nemotron 3.5 Super VL** (120B, 12B active) | It answers questions about pages rather than producing structure, and needs an H200 or two H100s. It is a candidate for a later figure-reading tool, not for parsing. |
| **NVIDIA Build API instead of Modal** | The fastest way to try the model, and usable for the first evaluation run. Modal gives a pinned revision, our own scaling and cost control, and no per-call vendor quota. |

## Consequences

**Good:**
- Agents read tables as tables.
- Image-only pages gain text.
- Results are cached per part across all users.
- Today's citation guarantee is unchanged.

**Costs and risks:**
- A new external service, with cold starts and GPU spend. This is limited by scale-to-zero and caching per PDF hash.
- A second text source can disagree with pdf.js. pdf.js wins for citations, by rule.
- OCR citations are weaker evidence. They are labelled and kept to image-only pages.
- The model is new. Its accuracy on our datasheets is unmeasured, so the status stays **Proposed** until the evaluation passes.

## Adoption gate

Adopt only if, on the 5 evaluation datasheets:
- pin-table rows are at least 98% exact;
- it beats the pdfplumber baseline on table cells;
- replayed reviews cut zero-match searches by at least half without more citation rejections;
- cached reads stay under 50 ms.

The full method is in the design doc.
