# v0.4.0 — RAG Positioning

**Status:** Draft → Approved by user 2026-05-14
**Target release:** 0.4.0 (minor bump, versionedNodeType preserves backward compat)
**Owner:** Sergei Frangulov
**Predecessor:** v0.3.0 production hardening (see `2026-05-14-production-hardening-design.md`)

## Context

`n8n-nodes-docx-to-md` is the only docx → Markdown community node without
external binary dependencies (Pandoc, Python/MarkItDown) and is the only
one with image extraction landing in v0.3.0. Three forum threads
(`/t/86343`, `/t/155736`, `/t/218414`) show users chaining docx ingest
into n8n's LangChain Default Data Loader and vector stores via brittle
Code-node hacks. No competitor (`@mazix/...converter-documents`,
`@bitovi/...markitdown`, `n8n-nodes-pandoc`) positions itself as
RAG-native. This release claims that ground.

The release combines two structural changes:

1. **`versionedNodeType` introduction.** The current single-operation
   node becomes `v1` (frozen). A new `v2` adds Resource/Operation UI so
   future operations can land without breaking existing workflows.
2. **New operation: `Extract for RAG`.** Splits the converted Markdown
   into LangChain-compatible chunks with rich metadata. N items per
   chunk. Heading path optionally prepended to each chunk's text.

## Goals

- Become the obvious first choice when a workflow looks like
  *Docx → chunked text → embeddings → vector store*.
- Match the LangChain `Document` shape (`pageContent` + `metadata`)
  exactly so n8n's built-in vector store nodes consume our output
  without an intermediate Default Data Loader.
- Surface the docx metadata (title, author, dates, pageCount, wordCount)
  that n8n RAG workflows commonly use for citation and filtering.
- Preserve `v1` behaviour bit-for-bit for existing workflows via
  `versionedNodeType`.

## Non-goals (deferred)

- Token-accurate chunk sizing via tiktoken. Char-approximation
  (4 chars ≈ 1 token) is enough for v0.4.0; tiktoken as a peer dep is
  deferred to v0.5.0 if requested.
- Semantic chunking (embedding-and-cluster). Vectara/NAACL 2025
  consistently shows fixed-size matches or beats it; not worth the
  complexity for v0.4.0.
- Hierarchical / parent-document retrieval. Requires compatible vector
  store and an auto-merging retriever; out of scope.
- Element categories (`Title` / `Table` / `NarrativeText`) à la
  Unstructured.io. Adds surface area; defer unless users ask.
- Page-anchored chunks. Real page boundaries require parsing docx page
  breaks; complex and rarely needed in practice.
- PDF / ODT / RTF input. Stays a docx-only node.

## Architecture: `versionedNodeType`

`n8n-workflow` exposes `INodeType` and `INodeTypeBaseDescription` plus
the `versioned` pattern (mirrored in n8n core nodes like HTTP Request).
We adopt:

```ts
// nodes/DocxToMd/DocxToMd.node.ts (the only registered file)
import { VersionedNodeType } from 'n8n-workflow';
import { DocxToMdV1 } from './v1/DocxToMdV1.node';
import { DocxToMdV2 } from './v2/DocxToMdV2.node';

export class DocxToMd extends VersionedNodeType {
  constructor() {
    const baseDescription: INodeTypeBaseDescription = {
      displayName: 'Docx to Markdown',
      name: 'docxToMd',
      icon: 'file:docxtomd.svg',
      group: ['transform'],
      defaultVersion: 2,
      description: 'Convert Word documents to Markdown, with RAG-ready chunking',
    };
    super({ 1: new DocxToMdV1(baseDescription), 2: new DocxToMdV2(baseDescription) }, baseDescription);
  }
}
```

`v1/DocxToMdV1.node.ts` is a one-time copy of the entire current
`DocxToMd.node.ts` body (post-v0.3.0). It is **frozen**: no further
changes, no new options, no bug fixes that change observable behaviour.
Workflows that were created against v1 always see the v1 instance.

`v2/DocxToMdV2.node.ts` is the new file. It introduces Resource +
Operation UI and contains both the `Convert` operation (verbatim copy of
v1's behaviour, just under the new UI scaffolding) and the new
`Extract for RAG` operation. New workflows pick up v2 by default.

Shared logic (`convertVerbose`, `htmlToMdWithImageRule`, helpers) moves
to a sibling module — likely `nodes/DocxToMd/shared/convert.ts` — so
both versions import from one source. The exported public API surface
(`convert`, `convertVerbose`, `ConvertOptions`, etc.) keeps the same
names and shapes; v1 imports them too.

## Operation: `Extract for RAG`

### UI

Under Resource: `Document`, Operation: `Extract for RAG`. Top-level
fields (always visible):

- `inputBinaryField` (string, default `data`, required) — same as today.

Operation-specific fields (one block, ordered most-important-first):

| Field | Type | Default | Notes |
|---|---|---|---|
| Chunk Size | number | `2000` | Characters. ≈500 tokens (4:1 approx). |
| Chunk Overlap | number | `200` | Characters. ~10% of chunk size. |
| Split Strategy | options | `markdownHeader` | `markdownHeader` (split on `#`/`##`/`###`, then size-cap with recursive splitting) / `recursive` (no heading split, pure recursive) / `fixed` (sliding window). |
| Prepend Heading Path | boolean | `true` | When true, prepends `H1 > H2 > H3\n\n` to each chunk's text. Boosts retrieval quality (contextual retrieval pattern). |
| Include Metadata | boolean | `true` | When false, items only contain `pageContent` + `chunkIndex` + `totalChunks`. |
| Source Field | string | empty | Optional. Value used for `metadata.source`. Defaults to the binary's `fileName` if absent. Supports n8n expressions. |
| Options | collection | `{}` | Reuses the v0.3.0 conversion options (Style Map, Validate Docx Signature, Custom Style Map, etc.). |

Notes:

- `Convert` operation under v2 mirrors the v0.3.0 single-operation node
  one-to-one. All v0.3.0 options remain available there.
- `Extract for RAG` reuses the conversion options collection (style
  map, signature check, GFM toggles) but does **not** expose
  image-related options — image extraction in a RAG chunk pipeline is
  out of scope for v0.4.0; the document is converted with images
  stripped from the Markdown (equivalent to `removeImages: true`)
  before chunking.

### Output

N items, one per chunk. Each item conforms to the LangChain `Document`
shape so the user can wire it straight into a vector store node:

```json
{
  "json": {
    "pageContent": "Introduction > Background\n\nThe Q3 strategy is …",
    "metadata": {
      "source": "Q3-Strategy.docx",
      "title": "Q3 Strategy Doc",
      "author": "Alice",
      "lastModifiedBy": "Bob",
      "createdAt": "2026-03-15T10:00:00Z",
      "modifiedAt": "2026-04-20T14:33:00Z",
      "revision": 12,
      "chunkIndex": 0,
      "totalChunks": 17,
      "headingPath": "Introduction > Background",
      "headings": { "h1": "Introduction", "h2": "Background" },
      "loc": { "lines": { "from": 12, "to": 43 } },
      "wordCount": 4831,
      "charCount": 28912,
      "pageCount": 18
    },
    "pairedItem": { "item": 0 }
  }
}
```

Field naming follows three conventions:

- `pageContent` + `metadata` — LangChain `Document` shape, mirrored
  exactly. Vector store nodes deserialize this without translation.
- `source`, `title`, `author`, `chunkIndex`, `totalChunks` — n8n
  community RAG-template conventions.
- `loc.lines.from/to` — LangChain RecursiveCharacterTextSplitter
  emits this; including it lets downstream re-ranking tools work
  without special-casing our output.

`pairedItem.item` keeps the index of the original input item (the docx
file) so multi-file batches retain provenance.

If `Include Metadata` is `false`, `metadata` is restricted to
`{ chunkIndex, totalChunks }`. `pageContent` always present.

## Implementation notes

### Module layout

```
nodes/DocxToMd/
├── DocxToMd.node.ts          (VersionedNodeType wrapper, the only registered file)
├── v1/
│   └── DocxToMdV1.node.ts    (frozen copy of v0.3.0 single-operation node)
├── v2/
│   ├── DocxToMdV2.node.ts    (Resource/Operation router for v2)
│   └── extractForRag.ts      (the new operation's implementation)
├── shared/
│   ├── convert.ts            (convertVerbose, htmlToMdWithImageRule, lint, helpers)
│   ├── metadata.ts           (extractDocxMetadata via JSZip)
│   ├── chunking.ts           (split strategies)
│   └── headings.ts           (parse heading tree from converted Markdown)
└── types.d.ts                (existing)
```

`v1/DocxToMdV1.node.ts` is the post-v0.3.0 file, moved verbatim. Its
helpers re-export from `shared/convert.ts` so the source of truth is
single. v2 imports the same helpers.

### Metadata extraction (`shared/metadata.ts`)

Docx is a ZIP. JSZip is already in `devDependencies`; promote to
`dependencies` for v0.4.0. Read these entries:

- `docProps/core.xml` (Dublin Core + cp namespace):
  - `dc:title` → `metadata.title`
  - `dc:creator` → `metadata.author`
  - `cp:lastModifiedBy` → `metadata.lastModifiedBy`
  - `dcterms:created` → `metadata.createdAt`
  - `dcterms:modified` → `metadata.modifiedAt`
  - `cp:revision` → `metadata.revision`
- `docProps/app.xml`:
  - `Words` → `metadata.wordCount`
  - `Characters` → `metadata.charCount`
  - `Pages` → `metadata.pageCount`
  - `Application` → discarded (not useful)

Parse via `node-html-parser` (already in `dependencies`) — XML-friendly
enough for these flat schemas. Missing entries → field absent, not
`null`. Wrap reads in try/catch — corrupt or unusual docx ZIPs should
not fail the operation, just omit metadata.

### Heading tree (`shared/headings.ts`)

After conversion, scan the Markdown line-by-line. For each line
matching `/^(#{1,6})\s+(.+)$/`, record `{ level, text, line }`. Build a
running "current heading path" by popping entries deeper than or equal
to the new heading's level, then pushing the new heading. The path at
any line is therefore `["H1 text", "H2 text", …]`.

Slug generation for `headings.h1`/`h2`/`h3` fields (when needed) uses
GitHub's algorithm — lowercase, spaces → `-`, strip non-alphanumerics
except `-`.

### Chunking (`shared/chunking.ts`)

Three strategies, all char-based.

`markdownHeader` (default):

1. Split the Markdown by H1/H2/H3 boundaries only. H4-H6 do not start a
   new chunk in v0.4.0 — they remain inside the H1/H2/H3 parent section
   and influence the `headingPath` metadata only. Configurable max
   heading level is a v0.5.0 follow-up if requested.
2. For each section, if its length ≤ `chunkSize`, emit one chunk.
   Otherwise pass it to the recursive splitter with the same
   `chunkSize` / `chunkOverlap` and emit each sub-chunk with the
   parent section's heading path.

`recursive`:

Mirror LangChain's `RecursiveCharacterTextSplitter`:

```
separators = ["\n\n", "\n", ". ", " ", ""]
```

For each separator in order, try splitting; if any piece exceeds
`chunkSize`, recurse with the next separator. The leaves are then
re-joined to honour `chunkOverlap`.

`fixed`:

Sliding window. `chunk_i = text[i*step : i*step + chunkSize]` where
`step = chunkSize - chunkOverlap`. Simplest possible; useful when
inputs are unstructured prose.

All strategies attach `loc.lines.from/to` by mapping char offsets back
to line numbers using a one-time newline index.

If `prependHeadingPath` is `true` and the chunk has a non-empty
`headingPath`, the final `pageContent` is `${path}\n\n${chunk_text}`;
the prefix counts toward neither `loc.lines` nor the in-doc char
position (it is a retrieval-time augmentation, not part of the
original document).

### `extractForRag.ts` operation

Per-item flow:

1. Read binary, validate docx signature, run `convertVerbose` with
   `removeImages: true` plus user-supplied conversion options.
2. Read metadata via `shared/metadata.ts` from the same buffer.
3. Build heading index via `shared/headings.ts`.
4. Chunk via `shared/chunking.ts`.
5. For each chunk, build a `pageContent` (with optional heading
   prepend) and a `metadata` object, push as a separate item with
   `pairedItem: { item: inputItemIndex }`.

`continueOnFail` semantics carry over from v0.3.0: per-input-item
try/catch; on error with `continueOnFail`, push one error item.

### Default `source` value

When `Source Field` is blank, fall back to the binary's `fileName`
(via `this.helpers.getBinaryMetadata(itemIndex, fieldName)` if the
binary has one), or — if absent — the literal `unknown` string.

## Tests

100% coverage requirement carries over. The plan adds:

- `shared/metadata.test.ts` — verify each field parsed from
  `docProps/core.xml` and `app.xml`. Cover the "missing entries"
  fallback.
- `shared/headings.test.ts` — heading-path stack across H1 → H2 → H3 →
  H2 → H1 transitions.
- `shared/chunking.test.ts` — each strategy on representative inputs:
  short doc (no split), long doc (multiple splits), markdown with
  heading-only structure.
- `v2/extractForRag.test.ts` — integration test on the existing
  `simple.docx` and a new fixture with multiple headings. Asserts the
  N-items output, the LangChain shape, the heading prepend behaviour.
- `v1/DocxToMdV1.test.ts` — a snapshot test confirming v1 still
  produces v0.3.0-identical output (load a few fixtures, compare to
  pre-recorded MD).

New fixture: `tests/fixtures/with-multiple-headings.docx` (built by
extending `build-fixtures.js`).

## Versioning & release

- `0.3.0` → `0.4.0` once the v0.3.0 beta promotes to `latest`. If
  v0.3.0 is still on `beta` when v0.4.0 lands, publish v0.4.0 also as
  `beta` and decide on promotion together.
- CHANGELOG entry: highlight `versionedNodeType`, `Extract for RAG`
  operation, LangChain `Document` shape, metadata fields.
- README: add a new "RAG / Vector Store integration" section with a
  worked example pipeline (Docx file → DocxToMd v2 Extract for RAG →
  Embeddings → Vector Store Insert).
- `jszip` moves from `devDependencies` to `dependencies` (it currently
  ships in the dev tree only for the fixture generator). Run-time
  footprint is ~95 KB minified — acceptable for a node already
  bundling mammoth + turndown + markdownlint.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| v1 frozen copy diverges from shared helpers | The frozen v1 imports from `shared/convert.ts` rather than vendoring; "frozen" means no UI changes, no new properties — internal refactors that preserve output are fine. |
| `markdownHeader` strategy splits on a heading mid-paragraph (e.g. `# in code block`) | The Markdown is post-turndown output; `#` in code blocks is preserved verbatim. Heading detection should skip lines inside fenced code blocks. Implement that. |
| `headingPath` prepend changes embeddings for users who later switch to a different embedder | The option is on by default but easy to disable. We document the trade-off in the README RAG section. |
| Bundle size growth from heavy chunking deps | We use no chunking libraries — implementation is ~150 lines of pure JS in `shared/chunking.ts`. No new runtime deps. |
| Users on `v1` never get RAG features | Intentional. They opt in by recreating the node as v2 (or starting a new workflow). |

## Out-of-scope follow-ups (post-0.4.0)

- **0.5.0**: tiktoken-aware chunking (peer-dep optional); element
  categories (Title / Table / NarrativeText) à la Unstructured.
- **0.6.0**: PDF input via `unpdf` (pure JS).
- **0.7.0**: page-anchored chunking once we have a docx page-break
  parser worth its weight.
- **Eventually**: drop v1 (major bump to v1.0.0 of the node). Don't
  rush; existing workflows are 30k installs/month.
