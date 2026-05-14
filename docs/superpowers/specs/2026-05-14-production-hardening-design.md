# v0.3.0 — Production Hardening & Options

**Status:** Draft → Approved by user 2026-05-14
**Target release:** 0.3.0 (minor bump, backward-compatible)
**Owner:** Sergei Frangulov

## Context

`n8n-nodes-docx-to-md` ships ~30k installs/month (npm), with ~7.2k/week,
~99.8% of which already run the latest version (`0.2.1`). The package is
a single-purpose docx→Markdown transformer with one user-facing option
(`removeImages`). Two pressures shape this release:

- **Production load.** A failing item kills the whole batch; mammoth
  conversion warnings (`messages`) are silently discarded; non-docx
  inputs raise opaque errors. None of this is acceptable at scale.
- **Competitive pressure.** `@mazix/n8n-nodes-converter-documents`
  (~6.4k/week, multi-format, AI-friendly) is the closest rival. They are
  ahead on breadth; we have a chance to win on depth (image extraction,
  warnings visibility, style maps, raw text) without bloating scope.

This spec covers a backward-compatible release that closes the obvious
production gaps and ships a small set of high-leverage options. Larger
moves (Resource/Operation refactor, PDF/ODT, reverse conversion) are
explicitly deferred.

## Goals

- Survive bad inputs without halting batches (`continueOnFail`).
- Surface mammoth conversion warnings to the workflow so users can debug
  why a doc looks wrong.
- Validate input is plausibly a `.docx` before invoking mammoth, so
  failures are legible.
- Expose the most-requested turndown/mammoth configuration through an
  alphabetised `Options` collection — the n8n-standard place for
  optional fields.
- Add image extraction as binary outputs (not just removal), with a
  user-controlled link-format strategy.

## Non-goals (deferred)

- Resource/Operation pattern, multiple operations.
- PDF, ODT, RTF, or any non-docx input.
- Markdown → DOCX reverse conversion.
- Configurable markdownlint rules / custom lint config.
- RAG-positioned output (heading tree, page anchors, chunk metadata).

## UX

### Existing top-level properties (unchanged)

- `inputBinaryField` (string, default `data`, required)
- `destinationOutputField` (string, default `text`, required)
- `removeImages` (boolean, default `false`) — kept for backward compat;
  description amended: *"Whether to strip images from the converted
  Markdown. Ignored when `Options > Extract Images` is on."*

### New collection: `options`

n8n `collection` named **Options**, alphabetised. All fields optional.

| Name | Type | Default | Description |
|---|---|---|---|
| Bullet List Marker | options (`-`/`*`/`+`) | `-` | Turndown `bulletListMarker`. |
| Code Block Style | options (`fenced`/`indented`) | `fenced` | Turndown `codeBlockStyle`. |
| Custom Style Map | fixedCollection of `{from, to}` pairs | `[]` | Mammoth style-map rules. Joined with `\n` and passed via `options.styleMap`. |
| Extract Images | boolean | `false` | Output images as binary keys `image_1`, `image_2`, … alongside the JSON. Wins over `removeImages` when both are set. |
| Heading Style | options (`atx`/`setext`) | `atx` | Turndown `headingStyle`. |
| Image Link Format | options (`binaryKey`/`none`/`placeholder`) | `binaryKey` | Only used when `Extract Images` is on. `binaryKey` → `![](image_1)` matches the binary field. `none` → drop MD references entirely. `placeholder` → `[[image_1]]` for templated downstream substitution (avoids collision with n8n's `{{ }}` expression syntax). |
| Include Raw Text | boolean | `false` | Add `rawText` to the JSON output (via `mammoth.extractRawText`). Useful for embeddings / search. |
| Include Warnings | boolean | `false` | Add `warnings: string[]` to the JSON output, sourced from `mammothResult.messages`. |
| Lint Markdown | boolean | `true` | When false, skip the `markdownlint` post-pass. |
| Table First Row as Header | boolean | `true` | Current `autoTableHeaders` behaviour exposed; some users want raw tables. |
| Validate Docx Signature | boolean | `true` | When true, reject input that does not begin with the ZIP magic `PK\x03\x04`. |

### Output shape

Backward-compatible. Default output is unchanged:

```json
{ "json": { "<destinationOutputField>": "<markdown>" } }
```

With options enabled, additional keys appear:

```json
{
  "json": {
    "<destinationOutputField>": "<markdown>",
    "warnings": ["Unrecognized paragraph style 'Quote'"],
    "rawText": "<plain text>"
  },
  "binary": {
    "image_1": { "data": "...", "mimeType": "image/png", "fileName": "image_1.png" },
    "image_2": { "data": "...", "mimeType": "image/jpeg", "fileName": "image_2.jpg" }
  }
}
```

`warnings` is only present when `Include Warnings` is on. `rawText` only
when `Include Raw Text` is on. `binary` only when `Extract Images` is on.

## Implementation notes

### `continueOnFail`

Wrap the per-item conversion in `try/catch`. On error:

```ts
if (this.continueOnFail()) {
  returnData.push({
    json: { error: (err as Error).message },
    error: new NodeOperationError(this.getNode(), err as Error, { itemIndex: i }),
    pairedItem: { item: i },
  });
  continue;
}
throw new NodeOperationError(this.getNode(), err as Error, { itemIndex: i });
```

All thrown `NodeOperationError`s gain `itemIndex` for better stack traces
in the n8n UI.

### Docx signature validation

```ts
function isDocxSignature(buf: Buffer): boolean {
  return buf.length >= 4
    && buf[0] === 0x50 && buf[1] === 0x4B
    && buf[2] === 0x03 && buf[3] === 0x04;
}
```

Run before mammoth when `Validate Docx Signature` is on. On failure
throw `NodeOperationError` with message
`"Input is not a valid .docx file (expected ZIP signature)"`.

### Image extraction

Use `mammoth.images.imgElement` to intercept each image during HTML
generation. Per image: allocate a key `image_<n>`, accumulate buffer +
mime type, and always emit `<img src="image_<n>">` from the callback
(mammoth's API expects an attributes object, not a free text node).

The `imageLinkFormat` choice is then applied via a turndown rule
registered before conversion:

- `binaryKey` (default): use turndown's built-in img handling →
  `![](image_<n>)`.
- `none`: rule returns `''` for every `<img>`.
- `placeholder`: rule returns `[[image_<n>]]` (uses the `src` value).

After conversion, attach each accumulated buffer to the output item as
binary data via `this.helpers.prepareBinaryData(buffer, fileName, mimeType)`.

`fileName` is derived as `image_<n>.<ext>` where `<ext>` comes from the
mime type (`image/png` → `png`, `image/jpeg` → `jpg`, etc.). Unknown
mime types fall back to `bin`.

### Mammoth warnings

`mammoth.convertToHtml` returns
`{ value: string, messages: Array<{type:'warning'|'error', message:string}> }`.
When `Include Warnings` is on, collect `messages.map(m => `[${m.type}] ${m.message}`)`
into the output JSON.

### Raw text

When `Include Raw Text` is on, run `mammoth.extractRawText(inputObj)` in
parallel with `convertToHtml`. Cheap (single pass over the document AST)
and gives users a plain-text fallback for LLM/embedding workflows.

### Custom style map

Mammoth accepts `options.styleMap` as a string (one rule per line) or as
an array of strings. The `fixedCollection` of `{from, to}` pairs is
joined as `${from} => ${to}` per line.

### TypeScript hygiene

Replace `@ts-ignore` on mammoth / turndown / markdownlint imports with
focused local declarations in `nodes/DocxToMd/types.d.ts`. Keep the
diff minimal — only what's used.

## Tests

100% coverage requirement stays. Each new option gets:

- 1 happy-path test exercising the option's primary effect.
- 1 edge-case test (option off, default value, or interaction with
  another option).

Additional new test suites:

- `continueOnFail.test.ts` — invalid-docx item in a 3-item batch:
  expect 2 outputs + 1 error item with `error` field.
- `signatureValidation.test.ts` — non-zip buffer rejected with the
  exact message.
- `imageExtraction.test.ts` — fixture docx with embedded image; assert
  binary output + correct MD reference per `imageLinkFormat` mode.
- `customStyleMap.test.ts` — fixture docx with a custom paragraph
  style, mapped to `blockquote`.
- `warnings.test.ts` — fixture docx that triggers a mammoth warning;
  assert `warnings` is present only when the option is on.

The existing `DocxToMdCredentialsApi.test.ts` is kept as-is. The
credentials class itself stays in place (currently unused but
intentionally retained for forward compatibility — e.g. future
operations that might call out to remote services).

## Versioning & release

- npm `0.2.1` → `0.3.0` (minor; new options, no breaking change).
- Add `CHANGELOG.md` (Keep-a-Changelog format) and seed it with a
  retroactive entry for `0.2.1` plus the new `0.3.0` notes.
- README: add a new **Options** section documenting every new field
  with a short rationale and a JSON example for the non-default
  output shape.
- The CI workflow already runs lint + build + tests with coverage; no
  changes needed there.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| New option breaks a real-world docx | Default values match current behaviour; every option is opt-in. |
| Image extraction balloons memory on large docx | mammoth already buffers the document; image binaries are written through `prepareBinaryData` immediately, not held twice. |
| `validateDocxSignature` rejects a doc someone uses today | Default on, but a single toggle disables it. The signature check is a 4-byte read — false positives are not realistic. |
| Custom style map syntax errors are silent | Mammoth's error path surfaces in `messages`; users with `Include Warnings` on will see them. |

## Out-of-scope follow-ups (post-0.3.0)

- **0.4.0:** Resource/Operation refactor; add `Extract Metadata` and
  `Extract for RAG` operations alongside the current convert flow.
- **0.5.0:** PDF input via `unpdf` (pure JS, no Pandoc dependency).
- **Later:** `versionedNodeType` migration to cleanly retire
  `removeImages`.
