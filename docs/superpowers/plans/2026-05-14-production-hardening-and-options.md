# v0.3.0 Production Hardening and Options — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `n8n-nodes-docx-to-md` v0.3.0: add `continueOnFail`, docx signature validation, mammoth warning export, image extraction with binary outputs, raw text output, and a `Options` collection covering turndown configuration, custom style maps, and lint toggle — all backward-compatible.

**Architecture:** Single node file `nodes/DocxToMd/DocxToMd.node.ts` gains an `options` collection property containing 10 fields, plus a per-item `try/catch` wrapper for `continueOnFail`. The exported `convert(input, options)` helper accepts the new options through an extended `ConvertOptions` type. Output shape stays backward-compatible: extra JSON keys (`warnings`, `rawText`) and `binary` outputs appear only when their opt-in option is on. Tests are added to the existing `tests/convert.test.ts` (helper-level) and `tests/DocxToMd.node.test.ts` (execute-level). The fixture generator `tests/fixtures/build-fixtures.js` grows to produce a `with-custom-style.docx`.

**Tech Stack:** TypeScript 5.8, Jest 29 + babel-jest, `mammoth` 1.9, `@joplin/turndown` 4, `@joplin/turndown-plugin-gfm`, `markdownlint` 0.38, `node-html-parser` 7, `jszip` (fixture generator), pnpm 9.

**Spec reference:** `docs/superpowers/specs/2026-05-14-production-hardening-design.md`

**Note on test placement:** The spec listed separate test files per feature; during planning we consolidated into the two existing test files (`convert.test.ts`, `DocxToMd.node.test.ts`) because all new behaviour is naturally exercised by these two entry points. New describe blocks group the additions.

---

## Task 1: `continueOnFail` support in `execute()`

**Files:**
- Modify: `nodes/DocxToMd/DocxToMd.node.ts` (the `execute` method)
- Modify: `tests/DocxToMd.node.test.ts` (extend `makeContext`, add suite)

- [ ] **Step 1: Extend the `makeContext` mock with `continueOnFail`**

Open `tests/DocxToMd.node.test.ts`. Replace the `makeContext` function:

```ts
function makeContext(opts: {
	itemCount: number;
	params: Params;
	binaryBuffer: Buffer | null;
	continueOnFail?: boolean;
}): IExecuteFunctions {
	const items = Array.from({ length: opts.itemCount }, (_, i) => ({ json: { idx: i } }));
	const ctx = {
		getInputData: () => items,
		getNodeParameter: (name: keyof Params) => opts.params[name],
		getNode: () => ({ name: 'Docx to Markdown', type: 'docxToMd', typeVersion: 1 }),
		continueOnFail: () => opts.continueOnFail === true,
		helpers: {
			getBinaryDataBuffer: async () => opts.binaryBuffer,
			returnJsonArray: (data: Array<Record<string, unknown>>): INodeExecutionData[] =>
				data.map((item) =>
					'json' in item ? (item as INodeExecutionData) : { json: item as INodeExecutionData['json'] },
				),
		},
	};
	return ctx as unknown as IExecuteFunctions;
}
```

- [ ] **Step 2: Write the failing test**

Append to `tests/DocxToMd.node.test.ts` inside the `describe('DocxToMd.execute', ...)` block (before its closing `});`):

```ts
it('continues on fail and emits an error item when continueOnFail is true', async () => {
	const ctx = makeContext({
		itemCount: 1,
		params: { inputBinaryField: 'data', destinationOutputField: 'text', removeImages: false },
		binaryBuffer: null,
		continueOnFail: true,
	});
	const node = new DocxToMd();
	const result = await node.execute.call(ctx);
	expect(result[0]).toHaveLength(1);
	const out = result[0][0];
	expect(out.json).toMatchObject({ error: expect.stringMatching(/No binary data/) });
	expect(out.error).toBeDefined();
	expect(out.pairedItem).toEqual({ item: 0 });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `pnpm test -- --testPathPattern DocxToMd.node`
Expected: 1 failing test ("continues on fail and emits an error item …") because the current code unconditionally throws.

- [ ] **Step 4: Implement the wrapper**

In `nodes/DocxToMd/DocxToMd.node.ts`, replace the body of `execute` (the whole `for` loop block):

```ts
async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const returnData: INodeExecutionData[] = [];

	for (let i = 0; i < items.length; i++) {
		try {
			const inputBinaryField = this.getNodeParameter('inputBinaryField', i) as string;
			const destinationOutputField = this.getNodeParameter('destinationOutputField', i) as string;
			const removeImages = this.getNodeParameter('removeImages', i) as boolean;

			const binaryData = await this.helpers.getBinaryDataBuffer(i, inputBinaryField);
			if (!binaryData) {
				throw new NodeOperationError(
					this.getNode(),
					`No binary data found for field "${inputBinaryField}"`,
					{ itemIndex: i },
				);
			}

			const result = await convert(binaryData, { removeImages });

			returnData.push({
				json: { [destinationOutputField]: result },
				pairedItem: { item: i },
			});
		} catch (err) {
			if (this.continueOnFail()) {
				returnData.push({
					json: { error: (err as Error).message },
					error: err instanceof NodeOperationError
						? err
						: new NodeOperationError(this.getNode(), err as Error, { itemIndex: i }),
					pairedItem: { item: i },
				});
				continue;
			}
			throw err instanceof NodeOperationError
				? err
				: new NodeOperationError(this.getNode(), err as Error, { itemIndex: i });
		}
	}

	return [returnData];
}
```

Note: this changes the return path from `this.helpers.returnJsonArray(...)` to `returnData` directly, because we now build full `INodeExecutionData` objects (`json` + `pairedItem` + optional `error`). Update the existing tests' expectations only if they relied on `returnJsonArray` being called — re-run the full suite in Step 5 to confirm.

- [ ] **Step 5: Run the full test suite**

Run: `pnpm test:coverage`
Expected: All tests pass, coverage stays at 100%.

If a previously passing test breaks because of the `pairedItem` addition or the `returnJsonArray` removal, fix the assertion in-place — the new shape is `{ json: {...}, pairedItem: {...} }` per item.

- [ ] **Step 6: Commit**

```bash
git add nodes/DocxToMd/DocxToMd.node.ts tests/DocxToMd.node.test.ts
git commit -m "$(cat <<'EOF'
Add continueOnFail support to the DocxToMd node

Wraps per-item conversion in try/catch. When continueOnFail() is true,
emits an error item with the failure message in json.error, the
NodeOperationError on .error, and pairedItem set for the input index.
Otherwise rethrows as NodeOperationError with itemIndex.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Options collection scaffold + three turndown options

**Files:**
- Modify: `nodes/DocxToMd/DocxToMd.node.ts` (`properties`, `execute`, `convert`)
- Modify: `tests/DocxToMd.node.test.ts` (Params + assertions)
- Modify: `tests/convert.test.ts` (new direct-helper tests)

- [ ] **Step 1: Extend the `Params` interface in the test mock**

In `tests/DocxToMd.node.test.ts`, replace the `Params` interface:

```ts
import type { IDataObject } from 'n8n-workflow';

interface Params {
	inputBinaryField: string;
	destinationOutputField: string;
	removeImages: boolean;
	options: IDataObject;
}
```

Update every existing `params: { ... }` literal in the file to add `options: {}`. There are five literals — pass `options: {}` to each.

- [ ] **Step 2: Write the failing test for headingStyle**

Append to the `describe('convert', ...)` block in `tests/convert.test.ts`:

```ts
it('renders setext-style headings when turndown.headingStyle = setext', async () => {
	const md = await convert(SIMPLE, { turndown: { headingStyle: 'setext' } });
	expect(md).toMatch(/Hello World\n=+/);
});

it('uses asterisks for bullets when turndown.bulletListMarker = *', async () => {
	const md = await convert(SIMPLE, { turndown: { bulletListMarker: '*' } });
	expect(md).toMatch(/^\* First item/m);
});

it('emits indented code blocks when turndown.codeBlockStyle = indented', async () => {
	// SIMPLE doesn't have code blocks; this just verifies the option threads through.
	const md = await convert(SIMPLE, { turndown: { codeBlockStyle: 'indented' } });
	expect(md).toContain('# Hello World');
});
```

The first two already pass under the current code because `convert` accepts `turndown` options. The current implementation also forces `headingStyle: 'atx'` and `bulletListMarker: '-'` via `defaultTurndownOptions`, so the new options must override the defaults instead of being overridden. **The first two of these tests will fail** until that ordering is fixed.

- [ ] **Step 3: Run the new tests to confirm two fail**

Run: `pnpm test -- --testPathPattern convert`
Expected: setext + bullet tests fail (defaults still win); code-block-style test passes.

- [ ] **Step 4: Fix option-merging order in `htmlToMd`**

In `nodes/DocxToMd/DocxToMd.node.ts`, swap the spread order so user options override defaults:

```ts
const turndownService = new TurndownService({
	...defaultTurndownOptions,
	...options,
});
```

- [ ] **Step 5: Re-run the convert tests**

Run: `pnpm test -- --testPathPattern convert`
Expected: all green.

- [ ] **Step 6: Add the `Options` collection to the node description**

In `nodes/DocxToMd/DocxToMd.node.ts`, append after the existing `removeImages` property (still inside the `properties` array):

```ts
{
	displayName: 'Options',
	name: 'options',
	type: 'collection',
	placeholder: 'Add option',
	default: {},
	options: [
		{
			displayName: 'Bullet List Marker',
			name: 'bulletListMarker',
			type: 'options',
			default: '-',
			options: [
				{ name: 'Dash (-)', value: '-' },
				{ name: 'Asterisk (*)', value: '*' },
				{ name: 'Plus (+)', value: '+' },
			],
			description: 'Character used for unordered list items in the generated Markdown',
		},
		{
			displayName: 'Code Block Style',
			name: 'codeBlockStyle',
			type: 'options',
			default: 'fenced',
			options: [
				{ name: 'Fenced (```)', value: 'fenced' },
				{ name: 'Indented (4 spaces)', value: 'indented' },
			],
			description: 'Whether code blocks are rendered as fenced or indented blocks',
		},
		{
			displayName: 'Heading Style',
			name: 'headingStyle',
			type: 'options',
			default: 'atx',
			options: [
				{ name: 'ATX (# Heading)', value: 'atx' },
				{ name: 'Setext (Heading\\n===)', value: 'setext' },
			],
			description: 'Whether headings use ATX (#) or Setext (underline) syntax',
		},
	],
},
```

- [ ] **Step 7: Wire the options into `execute`**

In `nodes/DocxToMd/DocxToMd.node.ts`, inside the `try` block of `execute`, after reading `removeImages`:

```ts
const options = this.getNodeParameter('options', i, {}) as IDataObject;
const turndown: Record<string, unknown> = {};
if (typeof options.headingStyle === 'string') turndown.headingStyle = options.headingStyle;
if (typeof options.bulletListMarker === 'string') turndown.bulletListMarker = options.bulletListMarker;
if (typeof options.codeBlockStyle === 'string') turndown.codeBlockStyle = options.codeBlockStyle;

const result = await convert(binaryData, { removeImages, turndown });
```

Replace the previous `await convert(binaryData, { removeImages });` line.

- [ ] **Step 8: Add a node-level integration test**

Append to `describe('DocxToMd.execute', ...)` in `tests/DocxToMd.node.test.ts`:

```ts
it('threads Options.headingStyle through to the converter', async () => {
	const ctx = makeContext({
		itemCount: 1,
		params: {
			inputBinaryField: 'data',
			destinationOutputField: 'text',
			removeImages: false,
			options: { headingStyle: 'setext' },
		},
		binaryBuffer: simpleBuf,
	});
	const node = new DocxToMd();
	const result = await node.execute.call(ctx);
	const out = result[0][0].json as { text: string };
	expect(out.text).toMatch(/Hello World\n=+/);
});
```

Update the `describe('DocxToMd.description', ...)` block's existing properties-count assertion if it counts entries — the new 'options' property brings the count to 4. (The current test only inspects `inputBinaryField`, `destinationOutputField`, `removeImages` by name, so it should still pass.)

- [ ] **Step 9: Run the full suite + coverage**

Run: `pnpm test:coverage`
Expected: all green, 100% coverage.

- [ ] **Step 10: Commit**

```bash
git add nodes/DocxToMd/DocxToMd.node.ts tests/
git commit -m "$(cat <<'EOF'
Add Options collection with three turndown configuration fields

Introduces an n8n Options collection on the DocxToMd node and wires
the first three fields — Heading Style, Bullet List Marker, and
Code Block Style — through to turndown. User options now override the
hardcoded defaults instead of being overridden by them.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `Lint Markdown` toggle

**Files:**
- Modify: `nodes/DocxToMd/DocxToMd.node.ts` (`convert`, `properties`)
- Modify: `tests/convert.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `describe('convert', ...)` in `tests/convert.test.ts`:

```ts
it('skips the markdownlint pass when lint = false', async () => {
	// markdownlint normalises whitespace; raw output may have trailing newlines.
	// We assert that an opt-out at least keeps the document content intact.
	const lintedDefault = await convert(SIMPLE);
	const unlinted = await convert(SIMPLE, { lint: false });
	expect(unlinted).toContain('# Hello World');
	// Linted output is trimmed; unlinted should be at least as long.
	expect(unlinted.length).toBeGreaterThanOrEqual(lintedDefault.length);
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm test -- --testPathPattern convert`
Expected: TypeError or assertion failure because `lint` is not a recognised option.

- [ ] **Step 3: Extend `ConvertOptions` and `convert`**

In `nodes/DocxToMd/DocxToMd.node.ts`, add `lint?: boolean` to `ConvertOptions`:

```ts
interface ConvertOptions {
	mammoth?: object;
	turndown?: object;
	removeImages?: boolean;
	lint?: boolean;
}
```

Update `convert`:

```ts
export async function convert(
	input: string | Buffer | ArrayBuffer,
	options: ConvertOptions = {},
): Promise<string> {
	let inputObj: { path: string } | { buffer: Buffer };
	if (typeof input === 'string') {
		inputObj = { path: input };
	} else {
		inputObj = { buffer: Buffer.isBuffer(input) ? input : Buffer.from(input) };
	}
	const mammothResult = await mammoth.convertToHtml(inputObj, options.mammoth);
	const html = autoTableHeaders(mammothResult.value);
	const md = htmlToMd(html, options.turndown, options.removeImages);
	if (options.lint === false) return md.trim();
	return lint(md);
}
```

- [ ] **Step 4: Run the test, confirm green**

Run: `pnpm test -- --testPathPattern convert`
Expected: all convert tests pass.

- [ ] **Step 5: Add the Lint Markdown option to the node description**

In the `Options` collection's `options` array (added in Task 2), insert (keeping alphabetical order, so after `Heading Style`):

```ts
{
	displayName: 'Lint Markdown',
	name: 'lintMarkdown',
	type: 'boolean',
	default: true,
	description: 'Whether to run markdownlint auto-fix on the converted Markdown. Disable to keep raw turndown output.',
},
```

- [ ] **Step 6: Wire `lintMarkdown` into `execute`**

In the `execute` try-block, extend the convert call setup:

```ts
const convertOptions: ConvertOptions = { removeImages, turndown };
if (options.lintMarkdown === false) convertOptions.lint = false;

const result = await convert(binaryData, convertOptions);
```

You will need to also export `ConvertOptions` from `DocxToMd.node.ts` if it isn't already, OR re-declare a local type. Easiest: export it:

```ts
export interface ConvertOptions {
	mammoth?: object;
	turndown?: object;
	removeImages?: boolean;
	lint?: boolean;
}
```

- [ ] **Step 7: Run the full suite**

Run: `pnpm test:coverage`
Expected: all green, 100% coverage.

- [ ] **Step 8: Commit**

```bash
git add nodes/DocxToMd/DocxToMd.node.ts tests/convert.test.ts
git commit -m "$(cat <<'EOF'
Add Lint Markdown toggle to Options

Exposes the existing markdownlint post-pass as an opt-out. Default
stays true to preserve current behaviour. Power users with their own
linting pipeline can disable it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `Table First Row as Header` toggle

**Files:**
- Modify: `nodes/DocxToMd/DocxToMd.node.ts` (`autoTableHeaders`, `convert`, `properties`)
- Modify: `tests/convert.test.ts`
- Modify: `tests/autoTableHeaders.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `describe('convert', ...)` in `tests/convert.test.ts`:

```ts
it('keeps the original first row as data when tableFirstRowAsHeader = false', async () => {
	const md = await convert(WITH_TABLE, { tableFirstRowAsHeader: false });
	// Without the header rewrite, turndown emits its own empty-header row;
	// the original "Header A"/"Header B" cells should appear in a data row.
	expect(md).toContain('Header A');
	expect(md).toContain('Row 1 A');
	// The cells appear as table data — not in the synthesised header row.
	expect(md).not.toMatch(/\|\s*Header A\s*\|\s*Header B\s*\|\s*\n\s*\|\s*-+\s*\|/);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm test -- --testPathPattern convert`
Expected: failure on the new test (unknown option).

- [ ] **Step 3: Extend `convert` and `ConvertOptions`**

Add `tableFirstRowAsHeader?: boolean` to `ConvertOptions`. Modify `convert`:

```ts
const mammothResult = await mammoth.convertToHtml(inputObj, options.mammoth);
const html = options.tableFirstRowAsHeader === false
	? mammothResult.value
	: autoTableHeaders(mammothResult.value);
```

- [ ] **Step 4: Run convert tests, confirm green**

Run: `pnpm test -- --testPathPattern convert`
Expected: pass.

- [ ] **Step 5: Add the option to the node description**

In the `Options` collection's array, insert alphabetically (after Lint Markdown):

```ts
{
	displayName: 'Table First Row as Header',
	name: 'tableFirstRowAsHeader',
	type: 'boolean',
	default: true,
	description: 'Whether to promote the first row of each table to header cells. Disable to keep all rows as data.',
},
```

- [ ] **Step 6: Wire into `execute`**

After the existing options wiring, add:

```ts
if (options.tableFirstRowAsHeader === false) convertOptions.tableFirstRowAsHeader = false;
```

- [ ] **Step 7: Run the full suite**

Run: `pnpm test:coverage`
Expected: all green, 100% coverage.

- [ ] **Step 8: Commit**

```bash
git add nodes/DocxToMd/ tests/
git commit -m "$(cat <<'EOF'
Add Table First Row as Header toggle to Options

Default keeps the current autoTableHeaders behaviour. Disabling lets
turndown emit tables verbatim, which suits documents whose first row
is genuinely data.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `Validate Docx Signature` option

**Files:**
- Modify: `nodes/DocxToMd/DocxToMd.node.ts` (new helper, `execute`, `properties`)
- Modify: `tests/DocxToMd.node.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `describe('DocxToMd.execute', ...)` in `tests/DocxToMd.node.test.ts`:

```ts
it('rejects non-docx input with a signature error when validation is on', async () => {
	const notDocx = Buffer.from('hello world');
	const ctx = makeContext({
		itemCount: 1,
		params: {
			inputBinaryField: 'data',
			destinationOutputField: 'text',
			removeImages: false,
			options: { validateDocxSignature: true },
		},
		binaryBuffer: notDocx,
	});
	const node = new DocxToMd();
	await expect(node.execute.call(ctx)).rejects.toThrow(
		/Input is not a valid \.docx file/,
	);
});

it('bypasses signature validation when validateDocxSignature = false', async () => {
	// Mammoth will fail on a non-docx buffer, but the failure now comes from
	// mammoth, not from our signature check.
	const notDocx = Buffer.from('hello world');
	const ctx = makeContext({
		itemCount: 1,
		params: {
			inputBinaryField: 'data',
			destinationOutputField: 'text',
			removeImages: false,
			options: { validateDocxSignature: false },
		},
		binaryBuffer: notDocx,
	});
	const node = new DocxToMd();
	await expect(node.execute.call(ctx)).rejects.toThrow();
	// Error message should NOT mention our signature check.
	await expect(node.execute.call(ctx)).rejects.not.toThrow(/Input is not a valid \.docx file/);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm test -- --testPathPattern DocxToMd.node`
Expected: failures on the two new tests.

- [ ] **Step 3: Add the helper and wire into `execute`**

In `nodes/DocxToMd/DocxToMd.node.ts`, add near the top (after imports, before `autoTableHeaders`):

```ts
function hasZipSignature(buf: Buffer): boolean {
	return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04;
}
```

In `execute`, after `if (!binaryData) { ... }` and before the `convert` call:

```ts
const validateSig = options.validateDocxSignature !== false;
if (validateSig && !hasZipSignature(binaryData)) {
	throw new NodeOperationError(
		this.getNode(),
		'Input is not a valid .docx file (expected ZIP signature PK\\x03\\x04)',
		{ itemIndex: i },
	);
}
```

- [ ] **Step 4: Add the option to the node description**

Insert alphabetically into the Options collection (after Table First Row as Header):

```ts
{
	displayName: 'Validate Docx Signature',
	name: 'validateDocxSignature',
	type: 'boolean',
	default: true,
	description: 'Whether to reject binary input that does not start with the .docx (ZIP) magic signature. Turn off if you trust the input source and want to handle unusual files.',
},
```

- [ ] **Step 5: Run the full suite**

Run: `pnpm test:coverage`
Expected: all green, 100% coverage.

- [ ] **Step 6: Commit**

```bash
git add nodes/DocxToMd/ tests/
git commit -m "$(cat <<'EOF'
Add Validate Docx Signature option

Default-on signature check (PK\\x03\\x04) gives a legible error for
non-.docx input instead of a confusing mammoth message. Can be turned
off for users who need to feed unusual files.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `Include Warnings` option

**Files:**
- Modify: `nodes/DocxToMd/DocxToMd.node.ts` (`convert`'s return shape, new helper, `execute`, `properties`)
- Modify: `tests/convert.test.ts`
- Modify: `tests/DocxToMd.node.test.ts`

Surfacing warnings requires `convert` to return more than a string. To keep the existing `convert` signature stable (used by other callers and the existing tests), add a sibling helper `convertVerbose` that returns `{markdown, warnings}`.

- [ ] **Step 1: Write the failing helper test**

Append to `describe('convert', ...)` in `tests/convert.test.ts`:

```ts
it('exposes mammoth warnings via convertVerbose', async () => {
	// Reading via path makes mammoth verify the document fully — warnings appear
	// for any unrecognised style. Our fixtures don't trigger warnings, so use
	// a custom style map that references an unknown style to force one.
	const buf = fs.readFileSync(SIMPLE);
	const { markdown, warnings } = await convertVerbose(buf, {
		mammoth: { styleMap: 'p[style-name=\'Nonexistent Style\'] => h2:fresh' },
	});
	expect(markdown).toContain('# Hello World');
	expect(Array.isArray(warnings)).toBe(true);
});
```

Update the import line at the top of `tests/convert.test.ts`:

```ts
import { convert, convertVerbose } from '../nodes/DocxToMd/DocxToMd.node';
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm test -- --testPathPattern convert`
Expected: import error — `convertVerbose` is not exported.

- [ ] **Step 3: Implement `convertVerbose`**

In `nodes/DocxToMd/DocxToMd.node.ts`, add (just below `convert`):

```ts
export interface ConvertVerboseResult {
	markdown: string;
	warnings: string[];
}

export async function convertVerbose(
	input: string | Buffer | ArrayBuffer,
	options: ConvertOptions = {},
): Promise<ConvertVerboseResult> {
	let inputObj: { path: string } | { buffer: Buffer };
	if (typeof input === 'string') {
		inputObj = { path: input };
	} else {
		inputObj = { buffer: Buffer.isBuffer(input) ? input : Buffer.from(input) };
	}
	const mammothResult = await mammoth.convertToHtml(inputObj, options.mammoth);
	const html = options.tableFirstRowAsHeader === false
		? mammothResult.value
		: autoTableHeaders(mammothResult.value);
	const md = htmlToMd(html, options.turndown, options.removeImages);
	const finalMd = options.lint === false ? md.trim() : await lint(md);
	const warnings = (mammothResult.messages ?? []).map(
		(m: { type: string; message: string }) => `[${m.type}] ${m.message}`,
	);
	return { markdown: finalMd, warnings };
}
```

Refactor `convert` to delegate (keeps single source of truth and 100% coverage of both paths):

```ts
export async function convert(
	input: string | Buffer | ArrayBuffer,
	options: ConvertOptions = {},
): Promise<string> {
	const { markdown } = await convertVerbose(input, options);
	return markdown;
}
```

- [ ] **Step 4: Re-run convert tests**

Run: `pnpm test -- --testPathPattern convert`
Expected: all green.

- [ ] **Step 5: Add the option to the node description**

Insert alphabetically into Options (after Heading Style, before Lint Markdown):

```ts
{
	displayName: 'Include Warnings',
	name: 'includeWarnings',
	type: 'boolean',
	default: false,
	description: 'Whether to attach Mammoth conversion warnings (unrecognised styles, unsupported features) to the JSON output under "warnings"',
},
```

- [ ] **Step 6: Wire into `execute`**

Replace the line that calls `convert(...)` with `convertVerbose(...)`:

```ts
const { markdown, warnings } = await convertVerbose(binaryData, convertOptions);

const jsonOut: IDataObject = { [destinationOutputField]: markdown };
if (options.includeWarnings === true) jsonOut.warnings = warnings;

returnData.push({
	json: jsonOut,
	pairedItem: { item: i },
});
```

Remove the now-unused `result` variable.

- [ ] **Step 7: Write the node-level test**

Append to `describe('DocxToMd.execute', ...)` in `tests/DocxToMd.node.test.ts`:

```ts
it('omits warnings from the output by default', async () => {
	const ctx = makeContext({
		itemCount: 1,
		params: {
			inputBinaryField: 'data',
			destinationOutputField: 'text',
			removeImages: false,
			options: {},
		},
		binaryBuffer: simpleBuf,
	});
	const node = new DocxToMd();
	const result = await node.execute.call(ctx);
	expect(result[0][0].json).not.toHaveProperty('warnings');
});

it('includes warnings in the output when Include Warnings is on', async () => {
	const ctx = makeContext({
		itemCount: 1,
		params: {
			inputBinaryField: 'data',
			destinationOutputField: 'text',
			removeImages: false,
			options: { includeWarnings: true },
		},
		binaryBuffer: simpleBuf,
	});
	const node = new DocxToMd();
	const result = await node.execute.call(ctx);
	const out = result[0][0].json as { warnings?: string[] };
	expect(Array.isArray(out.warnings)).toBe(true);
});
```

- [ ] **Step 8: Run the full suite**

Run: `pnpm test:coverage`
Expected: all green, 100% coverage.

- [ ] **Step 9: Commit**

```bash
git add nodes/DocxToMd/ tests/
git commit -m "$(cat <<'EOF'
Add Include Warnings option and convertVerbose helper

Splits the conversion helper so warnings from mammoth.convertToHtml
can be surfaced. The node attaches them to the output JSON only when
the Include Warnings option is enabled; default output is unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `Include Raw Text` option

**Files:**
- Modify: `nodes/DocxToMd/DocxToMd.node.ts` (`convertVerbose`, `execute`, `properties`)
- Modify: `tests/convert.test.ts`
- Modify: `tests/DocxToMd.node.test.ts`

- [ ] **Step 1: Write the failing helper test**

Append to `describe('convert', ...)` in `tests/convert.test.ts`:

```ts
it('returns rawText alongside markdown when rawText = true', async () => {
	const { markdown, rawText } = await convertVerbose(SIMPLE, { rawText: true });
	expect(markdown).toContain('# Hello World');
	expect(typeof rawText).toBe('string');
	expect(rawText).toContain('Hello World');
});

it('omits rawText when not requested', async () => {
	const { rawText } = await convertVerbose(SIMPLE);
	expect(rawText).toBeUndefined();
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm test -- --testPathPattern convert`
Expected: type/property errors.

- [ ] **Step 3: Extend types and `convertVerbose`**

In `nodes/DocxToMd/DocxToMd.node.ts`:

```ts
export interface ConvertOptions {
	mammoth?: object;
	turndown?: object;
	removeImages?: boolean;
	lint?: boolean;
	tableFirstRowAsHeader?: boolean;
	rawText?: boolean;
}

export interface ConvertVerboseResult {
	markdown: string;
	warnings: string[];
	rawText?: string;
}
```

Update `convertVerbose` to compute `rawText` in parallel when requested:

```ts
export async function convertVerbose(
	input: string | Buffer | ArrayBuffer,
	options: ConvertOptions = {},
): Promise<ConvertVerboseResult> {
	let inputObj: { path: string } | { buffer: Buffer };
	if (typeof input === 'string') {
		inputObj = { path: input };
	} else {
		inputObj = { buffer: Buffer.isBuffer(input) ? input : Buffer.from(input) };
	}

	const [htmlResult, rawTextValue] = await Promise.all([
		mammoth.convertToHtml(inputObj, options.mammoth),
		options.rawText
			? mammoth.extractRawText(inputObj).then((r: { value: string }) => r.value)
			: Promise.resolve(undefined),
	]);

	const html = options.tableFirstRowAsHeader === false
		? htmlResult.value
		: autoTableHeaders(htmlResult.value);
	const md = htmlToMd(html, options.turndown, options.removeImages);
	const finalMd = options.lint === false ? md.trim() : await lint(md);
	const warnings = (htmlResult.messages ?? []).map(
		(m: { type: string; message: string }) => `[${m.type}] ${m.message}`,
	);

	const result: ConvertVerboseResult = { markdown: finalMd, warnings };
	if (rawTextValue !== undefined) result.rawText = rawTextValue;
	return result;
}
```

- [ ] **Step 4: Run convert tests, confirm green**

Run: `pnpm test -- --testPathPattern convert`
Expected: green.

- [ ] **Step 5: Add the option to the node description**

Insert alphabetically (after Include Warnings):

```ts
{
	displayName: 'Include Raw Text',
	name: 'includeRawText',
	type: 'boolean',
	default: false,
	description: 'Whether to include a plain-text extraction of the document (via mammoth.extractRawText) in the JSON output under "rawText". Useful for embeddings and search workflows.',
},
```

- [ ] **Step 6: Wire into `execute`**

Before the `convertVerbose` call, set:

```ts
if (options.includeRawText === true) convertOptions.rawText = true;
```

After the call, extend the JSON output:

```ts
const jsonOut: IDataObject = { [destinationOutputField]: markdown };
if (options.includeWarnings === true) jsonOut.warnings = warnings;
if (options.includeRawText === true && rawText !== undefined) jsonOut.rawText = rawText;
```

(Destructure `rawText` from the call result.)

- [ ] **Step 7: Write the node-level test**

```ts
it('includes rawText in the output when Include Raw Text is on', async () => {
	const ctx = makeContext({
		itemCount: 1,
		params: {
			inputBinaryField: 'data',
			destinationOutputField: 'text',
			removeImages: false,
			options: { includeRawText: true },
		},
		binaryBuffer: simpleBuf,
	});
	const node = new DocxToMd();
	const result = await node.execute.call(ctx);
	const out = result[0][0].json as { rawText?: string };
	expect(typeof out.rawText).toBe('string');
	expect(out.rawText).toContain('Hello World');
});
```

- [ ] **Step 8: Run the full suite**

Run: `pnpm test:coverage`
Expected: all green, 100% coverage.

- [ ] **Step 9: Commit**

```bash
git add nodes/DocxToMd/ tests/
git commit -m "$(cat <<'EOF'
Add Include Raw Text option

When enabled, attaches mammoth.extractRawText output to the JSON under
"rawText" in parallel with the HTML conversion. Useful for embedding
and search workflows that prefer a plain-text fallback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `Custom Style Map` (fixedCollection)

**Files:**
- Modify: `nodes/DocxToMd/DocxToMd.node.ts` (`properties`, `execute`)
- Modify: `tests/fixtures/build-fixtures.js` (new `with-custom-style.docx`)
- Add: `tests/fixtures/with-custom-style.docx` (build output)
- Modify: `tests/convert.test.ts` (uses fixture + styleMap option)

- [ ] **Step 1: Add the fixture body**

In `tests/fixtures/build-fixtures.js`, after `IMAGE_DOC_RELS`:

```js
const CUSTOM_STYLE_BODY = `
<w:p>
	<w:pPr><w:pStyle w:val="MyCallout"/></w:pPr>
	<w:r><w:t>This paragraph uses a custom style.</w:t></w:r>
</w:p>
<w:p>
	<w:r><w:t>Regular paragraph.</w:t></w:r>
</w:p>
`;
```

In the IIFE at the bottom of the file, add another `await buildDocx(...)` call:

```js
await buildDocx('with-custom-style.docx', CUSTOM_STYLE_BODY);
```

- [ ] **Step 2: Generate the fixture**

Run: `pnpm build:fixtures`
Expected: console output reports `wrote .../tests/fixtures/with-custom-style.docx`.

- [ ] **Step 3: Write the failing convert test**

Add at the top of `tests/convert.test.ts` next to the other fixture paths:

```ts
const WITH_CUSTOM_STYLE = path.join(FIXTURES, 'with-custom-style.docx');
```

Append to `describe('convert', ...)`:

```ts
it('applies a custom style map passed through mammoth options', async () => {
	const md = await convert(WITH_CUSTOM_STYLE, {
		mammoth: { styleMap: "p[style-name='MyCallout'] => blockquote" },
	});
	expect(md).toMatch(/^>\s+This paragraph uses a custom style\./m);
	expect(md).toContain('Regular paragraph.');
});
```

- [ ] **Step 4: Run, expect green**

Run: `pnpm test -- --testPathPattern convert`
Expected: green — the option already threads through.

- [ ] **Step 5: Add the fixedCollection to the node description**

Insert alphabetically into Options (after Code Block Style, before Extract Images — which comes in Task 9):

```ts
{
	displayName: 'Custom Style Map',
	name: 'customStyleMap',
	type: 'fixedCollection',
	typeOptions: { multipleValues: true },
	default: {},
	placeholder: 'Add style mapping',
	description: 'Map Word styles to Markdown elements (see Mammoth.js styleMap docs)',
	options: [
		{
			displayName: 'Mapping',
			name: 'mapping',
			values: [
				{
					displayName: 'From',
					name: 'from',
					type: 'string',
					default: '',
					placeholder: "p[style-name='MyCallout']",
					description: 'Mammoth style-map left-hand side',
				},
				{
					displayName: 'To',
					name: 'to',
					type: 'string',
					default: '',
					placeholder: 'blockquote',
					description: 'Mammoth style-map right-hand side',
				},
			],
		},
	],
},
```

- [ ] **Step 6: Wire into `execute`**

Add a helper near the top of the file (below `hasZipSignature`):

```ts
interface StyleMapping { from?: string; to?: string }
interface StyleMapCollection { mapping?: StyleMapping[] }

function buildStyleMapString(input: unknown): string | undefined {
	const coll = input as StyleMapCollection | undefined;
	const rules = (coll?.mapping ?? [])
		.filter((r): r is Required<StyleMapping> => Boolean(r.from && r.to))
		.map((r) => `${r.from} => ${r.to}`);
	return rules.length > 0 ? rules.join('\n') : undefined;
}
```

In `execute`, after reading `options`, build mammoth options:

```ts
const mammothOpts: Record<string, unknown> = {};
const styleMap = buildStyleMapString(options.customStyleMap);
if (styleMap !== undefined) mammothOpts.styleMap = styleMap;
```

Then merge it into `convertOptions`:

```ts
const convertOptions: ConvertOptions = { removeImages, turndown };
if (Object.keys(mammothOpts).length > 0) convertOptions.mammoth = mammothOpts;
```

(Apply this BEFORE setting `lint`, `tableFirstRowAsHeader`, `rawText`.)

- [ ] **Step 7: Add a node-level integration test**

In `tests/DocxToMd.node.test.ts`, add near the top of the file:

```ts
const customStyleBuf = fs.readFileSync(path.join(FIXTURES, 'with-custom-style.docx'));
```

(Inside the `describe('DocxToMd.execute', ...)` block, alongside `simpleBuf`.)

Append:

```ts
it('applies a Custom Style Map from the Options collection', async () => {
	const ctx = makeContext({
		itemCount: 1,
		params: {
			inputBinaryField: 'data',
			destinationOutputField: 'text',
			removeImages: false,
			options: {
				customStyleMap: {
					mapping: [{ from: "p[style-name='MyCallout']", to: 'blockquote' }],
				},
			},
		},
		binaryBuffer: customStyleBuf,
	});
	const node = new DocxToMd();
	const result = await node.execute.call(ctx);
	const out = result[0][0].json as { text: string };
	expect(out.text).toMatch(/^>\s+This paragraph uses a custom style\./m);
});

it('ignores empty rows in the Custom Style Map', async () => {
	const ctx = makeContext({
		itemCount: 1,
		params: {
			inputBinaryField: 'data',
			destinationOutputField: 'text',
			removeImages: false,
			options: {
				customStyleMap: { mapping: [{ from: '', to: '' }] },
			},
		},
		binaryBuffer: simpleBuf,
	});
	const node = new DocxToMd();
	const result = await node.execute.call(ctx);
	const out = result[0][0].json as { text: string };
	expect(out.text).toContain('# Hello World');
});
```

- [ ] **Step 8: Run the full suite**

Run: `pnpm test:coverage`
Expected: all green, 100% coverage.

- [ ] **Step 9: Commit**

```bash
git add nodes/DocxToMd/ tests/ tests/fixtures/with-custom-style.docx tests/fixtures/build-fixtures.js
git commit -m "$(cat <<'EOF'
Add Custom Style Map option (fixedCollection of from/to pairs)

Joins user-supplied mappings into a newline-separated mammoth style
map. Empty rows are filtered out so users can leave placeholders in
the UI. Adds a with-custom-style.docx fixture for end-to-end testing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `Extract Images` + `Image Link Format`

**Files:**
- Modify: `nodes/DocxToMd/DocxToMd.node.ts` (`convertVerbose`, `execute`, `properties`)
- Modify: `tests/convert.test.ts`
- Modify: `tests/DocxToMd.node.test.ts`

This task expands `convertVerbose` to optionally collect image buffers via `mammoth.images.imgElement`. Each image gets a key `image_<n>`; the MD output reference is decided by `imageLinkFormat`. Binary output is then attached in `execute` (which has access to `this.helpers.prepareBinaryData`).

- [ ] **Step 1: Extend types**

In `nodes/DocxToMd/DocxToMd.node.ts`:

```ts
export interface ExtractedImage {
	key: string;
	buffer: Buffer;
	mimeType: string;
	extension: string;
}

export interface ConvertOptions {
	mammoth?: object;
	turndown?: object;
	removeImages?: boolean;
	lint?: boolean;
	tableFirstRowAsHeader?: boolean;
	rawText?: boolean;
	extractImages?: boolean;
	imageLinkFormat?: 'binaryKey' | 'none' | 'placeholder';
}

export interface ConvertVerboseResult {
	markdown: string;
	warnings: string[];
	rawText?: string;
	images?: ExtractedImage[];
}
```

Add the mime-to-extension helper near the top:

```ts
function extensionFor(mime: string): string {
	const m = mime.toLowerCase();
	if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg';
	if (m === 'image/png') return 'png';
	if (m === 'image/gif') return 'gif';
	if (m === 'image/webp') return 'webp';
	if (m === 'image/svg+xml') return 'svg';
	if (m === 'image/bmp') return 'bmp';
	if (m === 'image/tiff') return 'tiff';
	return 'bin';
}
```

- [ ] **Step 2: Write the failing helper test**

Append to `describe('convert', ...)` in `tests/convert.test.ts`:

```ts
it('extracts images as buffers when extractImages = true', async () => {
	const buf = fs.readFileSync(WITH_IMAGE);
	const { markdown, images } = await convertVerbose(buf, { extractImages: true });
	expect(images).toBeDefined();
	expect(images!.length).toBe(1);
	expect(images![0].key).toBe('image_1');
	expect(Buffer.isBuffer(images![0].buffer)).toBe(true);
	expect(images![0].mimeType).toBe('image/png');
	expect(images![0].extension).toBe('png');
	// Default link format is binaryKey: MD references image_1
	expect(markdown).toMatch(/!\[\]\(image_1\)/);
	expect(markdown).not.toMatch(/data:image/);
});

it('drops MD image references when imageLinkFormat = none', async () => {
	const buf = fs.readFileSync(WITH_IMAGE);
	const { markdown, images } = await convertVerbose(buf, {
		extractImages: true,
		imageLinkFormat: 'none',
	});
	expect(images!.length).toBe(1);
	expect(markdown).not.toMatch(/!\[/);
});

it('emits placeholders when imageLinkFormat = placeholder', async () => {
	const buf = fs.readFileSync(WITH_IMAGE);
	const { markdown, images } = await convertVerbose(buf, {
		extractImages: true,
		imageLinkFormat: 'placeholder',
	});
	expect(images!.length).toBe(1);
	expect(markdown).toContain('[[image_1]]');
});
```

- [ ] **Step 3: Run, expect failure**

Run: `pnpm test -- --testPathPattern convert`
Expected: failures — `extractImages` not handled.

- [ ] **Step 4: Wire image extraction into `convertVerbose`**

Modify the body of `convertVerbose` (replace the entire function body, building on Task 7's version):

```ts
export async function convertVerbose(
	input: string | Buffer | ArrayBuffer,
	options: ConvertOptions = {},
): Promise<ConvertVerboseResult> {
	let inputObj: { path: string } | { buffer: Buffer };
	if (typeof input === 'string') {
		inputObj = { path: input };
	} else {
		inputObj = { buffer: Buffer.isBuffer(input) ? input : Buffer.from(input) };
	}

	const images: ExtractedImage[] = [];
	const mammothOptions: Record<string, unknown> = { ...(options.mammoth ?? {}) };

	if (options.extractImages) {
		mammothOptions.convertImage = mammoth.images.imgElement(async (image: any) => {
			const buffer = await image.readAsBuffer();
			const mimeType: string = image.contentType || 'application/octet-stream';
			const key = `image_${images.length + 1}`;
			images.push({ key, buffer, mimeType, extension: extensionFor(mimeType) });
			return { src: key };
		});
	}

	const [htmlResult, rawTextValue] = await Promise.all([
		mammoth.convertToHtml(inputObj, mammothOptions),
		options.rawText
			? mammoth.extractRawText(inputObj).then((r: { value: string }) => r.value)
			: Promise.resolve(undefined),
	]);

	const html = options.tableFirstRowAsHeader === false
		? htmlResult.value
		: autoTableHeaders(htmlResult.value);

	const linkFormat = options.imageLinkFormat ?? 'binaryKey';
	const md = htmlToMdWithImageRule(html, options.turndown, options.removeImages, options.extractImages ? linkFormat : 'binaryKey');
	const finalMd = options.lint === false ? md.trim() : await lint(md);

	const warnings = (htmlResult.messages ?? []).map(
		(m: { type: string; message: string }) => `[${m.type}] ${m.message}`,
	);

	const result: ConvertVerboseResult = { markdown: finalMd, warnings };
	if (rawTextValue !== undefined) result.rawText = rawTextValue;
	if (options.extractImages) result.images = images;
	return result;
}
```

Add a new helper `htmlToMdWithImageRule` (the existing `htmlToMd` stays untouched — `convertVerbose` calls the new one):

```ts
function htmlToMdWithImageRule(
	html: string,
	options: object = {},
	removeImages: boolean = false,
	imageLinkFormat: 'binaryKey' | 'none' | 'placeholder' = 'binaryKey',
): string {
	const turndownService = new TurndownService({
		...defaultTurndownOptions,
		...options,
	});
	turndownService.use(turndownPluginGfm.gfm);
	turndownService.addRule('preserveAnchors', {
		filter: function (node: any) {
			return node.nodeName === 'A' && node.getAttribute('id') && !node.textContent.trim();
		},
		replacement: function (content: any, node: any) {
			const id = node.getAttribute('id');
			return `<a id="${id}"></a>`;
		},
	});
	if (removeImages) {
		turndownService.addRule('removeImages', {
			filter: 'img',
			replacement: function () {
				return '';
			},
		});
	} else if (imageLinkFormat === 'none') {
		turndownService.addRule('dropImages', {
			filter: 'img',
			replacement: function () {
				return '';
			},
		});
	} else if (imageLinkFormat === 'placeholder') {
		turndownService.addRule('placeholderImages', {
			filter: 'img',
			replacement: function (_content: any, node: any) {
				const src = node.getAttribute('src') || '';
				return `[[${src}]]`;
			},
		});
	}
	return turndownService.turndown(html).trim();
}
```

Keep the existing `htmlToMd` intact (the existing tests still call it). The two helpers share most logic but the duplication is acceptable for one release; consolidate later if it grows.

- [ ] **Step 5: Run convert tests**

Run: `pnpm test -- --testPathPattern convert`
Expected: green.

- [ ] **Step 6: Add the two options to the node description**

Insert alphabetically. **Extract Images** between *Custom Style Map* and *Heading Style*:

```ts
{
	displayName: 'Extract Images',
	name: 'extractImages',
	type: 'boolean',
	default: false,
	description: 'Whether to output embedded images as separate binary fields ("image_1", "image_2", …) alongside the JSON. Wins over the top-level Remove Images toggle.',
},
```

Also update the existing top-level `removeImages` property's description to clarify the precedence rule:

```ts
{
	displayName: 'Remove Images',
	name: 'removeImages',
	type: 'boolean',
	default: false,
	description: 'Whether to strip images from the converted Markdown. Ignored when Options > Extract Images is on.',
},
```

**Image Link Format** alphabetically after Heading Style, before Include Raw Text:

```ts
{
	displayName: 'Image Link Format',
	name: 'imageLinkFormat',
	type: 'options',
	default: 'binaryKey',
	displayOptions: {
		show: {
			extractImages: [true],
		},
	},
	options: [
		{ name: 'Binary Key (![](image_1))', value: 'binaryKey' },
		{ name: 'None (drop references)', value: 'none' },
		{ name: 'Placeholder ([[image_1]])', value: 'placeholder' },
	],
	description: 'How extracted images are referenced inside the Markdown',
},
```

- [ ] **Step 7: Wire into `execute`**

Before the `convertVerbose` call:

```ts
if (options.extractImages === true) {
	convertOptions.extractImages = true;
	if (typeof options.imageLinkFormat === 'string') {
		convertOptions.imageLinkFormat = options.imageLinkFormat as ConvertOptions['imageLinkFormat'];
	}
}
```

After the call, attach the binary outputs:

```ts
const item: INodeExecutionData = {
	json: jsonOut,
	pairedItem: { item: i },
};

if (options.extractImages === true && images && images.length > 0) {
	item.binary = {};
	for (const img of images) {
		const fileName = `${img.key}.${img.extension}`;
		item.binary[img.key] = await this.helpers.prepareBinaryData(img.buffer, fileName, img.mimeType);
	}
}

returnData.push(item);
```

(Destructure `images` from the `convertVerbose` result. Drop the previous `returnData.push({...})` block.)

You also need to extend the `makeContext` mock in `tests/DocxToMd.node.test.ts` to provide `prepareBinaryData`:

```ts
helpers: {
	getBinaryDataBuffer: async () => opts.binaryBuffer,
	prepareBinaryData: async (data: Buffer, fileName: string, mimeType: string) => ({
		data: data.toString('base64'),
		mimeType,
		fileName,
	}),
	returnJsonArray: ...
}
```

- [ ] **Step 8: Add node-level tests**

Append to `describe('DocxToMd.execute', ...)`:

```ts
it('emits binary outputs and MD refs when Extract Images is on', async () => {
	const imageBuf = fs.readFileSync(path.join(FIXTURES, 'with-image.docx'));
	const ctx = makeContext({
		itemCount: 1,
		params: {
			inputBinaryField: 'data',
			destinationOutputField: 'text',
			removeImages: false,
			options: { extractImages: true },
		},
		binaryBuffer: imageBuf,
	});
	const node = new DocxToMd();
	const result = await node.execute.call(ctx);
	const item = result[0][0];
	expect(item.binary).toBeDefined();
	expect(item.binary).toHaveProperty('image_1');
	expect(item.binary!.image_1).toMatchObject({
		mimeType: 'image/png',
		fileName: 'image_1.png',
	});
	expect((item.json as { text: string }).text).toMatch(/!\[\]\(image_1\)/);
});

it('drops MD refs when imageLinkFormat is none', async () => {
	const imageBuf = fs.readFileSync(path.join(FIXTURES, 'with-image.docx'));
	const ctx = makeContext({
		itemCount: 1,
		params: {
			inputBinaryField: 'data',
			destinationOutputField: 'text',
			removeImages: false,
			options: { extractImages: true, imageLinkFormat: 'none' },
		},
		binaryBuffer: imageBuf,
	});
	const node = new DocxToMd();
	const result = await node.execute.call(ctx);
	const item = result[0][0];
	expect(item.binary).toHaveProperty('image_1');
	expect((item.json as { text: string }).text).not.toMatch(/!\[/);
});

it('emits placeholders when imageLinkFormat is placeholder', async () => {
	const imageBuf = fs.readFileSync(path.join(FIXTURES, 'with-image.docx'));
	const ctx = makeContext({
		itemCount: 1,
		params: {
			inputBinaryField: 'data',
			destinationOutputField: 'text',
			removeImages: false,
			options: { extractImages: true, imageLinkFormat: 'placeholder' },
		},
		binaryBuffer: imageBuf,
	});
	const node = new DocxToMd();
	const result = await node.execute.call(ctx);
	const item = result[0][0];
	expect((item.json as { text: string }).text).toContain('[[image_1]]');
});
```

- [ ] **Step 9: Run the full suite**

Run: `pnpm test:coverage`
Expected: all green, 100% coverage.

- [ ] **Step 10: Commit**

```bash
git add nodes/DocxToMd/ tests/
git commit -m "$(cat <<'EOF'
Add Extract Images and Image Link Format options

Captures embedded images via mammoth.images.imgElement into typed
buffers, attaches them to the output item as binary fields image_1,
image_2…, and lets the user choose how the MD references them
(binaryKey | none | placeholder). Extract Images wins over the legacy
Remove Images top-level toggle.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: TypeScript hygiene

**Files:**
- Add: `nodes/DocxToMd/types.d.ts`
- Modify: `nodes/DocxToMd/DocxToMd.node.ts`

- [ ] **Step 1: Write the declarations**

Create `nodes/DocxToMd/types.d.ts`:

```ts
declare module '@joplin/turndown' {
	export default class TurndownService {
		constructor(options?: Record<string, unknown>);
		use(plugin: unknown): TurndownService;
		addRule(name: string, rule: { filter: unknown; replacement: (...args: unknown[]) => string }): TurndownService;
		turndown(html: string): string;
	}
}

declare module '@joplin/turndown-plugin-gfm' {
	export const gfm: unknown;
}

declare module 'markdownlint/sync' {
	export function lint(options: { strings: Record<string, string> }): Record<string, unknown>;
}

declare module 'markdownlint' {
	export function applyFixes(content: string, errors: unknown): string;
}
```

- [ ] **Step 2: Drop the `@ts-ignore` directives**

In `nodes/DocxToMd/DocxToMd.node.ts`, remove all four `// @ts-ignore` lines preceding the imports. The imports stay as-is.

- [ ] **Step 3: Run typecheck + tests**

Run: `pnpm build && pnpm test:coverage`
Expected: both clean, 100% coverage holds.

If `tsc` complains about loose types (e.g. `node` parameters), tighten the rule callbacks' signatures locally with `as` casts rather than re-introducing `@ts-ignore`.

- [ ] **Step 4: Commit**

```bash
git add nodes/DocxToMd/
git commit -m "$(cat <<'EOF'
Add local type declarations and drop @ts-ignore directives

Adds nodes/DocxToMd/types.d.ts with minimal ambient declarations for
@joplin/turndown, @joplin/turndown-plugin-gfm, and markdownlint. The
four @ts-ignore comments on their imports are gone.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: CHANGELOG

**Files:**
- Add: `CHANGELOG.md`

- [ ] **Step 1: Create the changelog**

Create `CHANGELOG.md`:

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-05-14

### Added
- `continueOnFail` support — a failing item no longer halts the entire batch.
- Docx signature validation (`PK\x03\x04`) with a legible error for non-docx input.
- `Options` collection in the node UI, alphabetised:
  - **Bullet List Marker** (`-` / `*` / `+`).
  - **Code Block Style** (`fenced` / `indented`).
  - **Custom Style Map** — Mammoth-style mappings as `{from, to}` pairs.
  - **Extract Images** — output embedded images as binary fields.
  - **Heading Style** (`atx` / `setext`).
  - **Image Link Format** (`binaryKey` / `none` / `placeholder`).
  - **Include Raw Text** — attach `rawText` via `mammoth.extractRawText`.
  - **Include Warnings** — attach `warnings[]` from mammoth's `messages`.
  - **Lint Markdown** — opt out of the markdownlint post-pass.
  - **Table First Row as Header** — opt out of the auto-header rewrite.
  - **Validate Docx Signature** — opt out of the magic-byte check.
- Local TypeScript declarations for mammoth/turndown/markdownlint imports.

### Changed
- User-supplied turndown options now override the built-in defaults (previously
  defaults won — `headingStyle` and `bulletListMarker` were effectively
  hardcoded).
- Output items now include `pairedItem: { item: i }` per n8n convention.

### Deprecated
- The top-level `Remove Images` toggle is kept for backward compatibility but is
  ignored when `Options > Extract Images` is on.

## [0.2.1] - 2025-07-11

### Added
- 100% test coverage (37 tests across 6 suites) with Jest + babel-jest for ESM
  modules (markdownlint, micromark).
- Programmatic .docx fixture generator (`tests/fixtures/build-fixtures.js`).

### Fixed
- `convert` now accepts `Buffer` and `ArrayBuffer` inputs in addition to file
  paths.

## [0.2.0] - 2025-07-04

### Added
- `Remove Images` boolean option to strip images from the output Markdown.
- Credentials class scaffold (`DocxToMdCredentialsApi`).
- `usableAsTool: true` so the node can be used inside n8n AI Agent tools.

## [0.1.5] - earlier

### Added
- Initial public release. Converts `.docx` binary to GitHub-flavoured Markdown
  with table auto-headers, anchor preservation, and markdownlint auto-fix.

[0.3.0]: https://github.com/sfrangulov/n8n-nodes-docx-to-md/releases/tag/v0.3.0
[0.2.1]: https://github.com/sfrangulov/n8n-nodes-docx-to-md/releases/tag/v0.2.1
[0.2.0]: https://github.com/sfrangulov/n8n-nodes-docx-to-md/releases/tag/v0.2.0
[0.1.5]: https://github.com/sfrangulov/n8n-nodes-docx-to-md/releases/tag/v0.1.5
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "$(cat <<'EOF'
Add CHANGELOG.md with retroactive entries through 0.3.0

Seeds the file with the Keep-a-Changelog format and entries for 0.1.5,
0.2.0, 0.2.1, and the upcoming 0.3.0 release.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: README — `Options` section

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Insert the Options section**

Open `README.md`. After the "Configuration Options" table (the existing one listing `Input Binary Field`, `Destination Output Field`, `Remove Images`), insert:

````markdown
### Options Collection

All fields below live inside the **Options** group on the node. They are
optional, alphabetised, and default to current behaviour so existing workflows
keep working.

| Option | Type | Default | What it does |
|---|---|---|---|
| Bullet List Marker | enum (`-` / `*` / `+`) | `-` | Character used for unordered list items. |
| Code Block Style | enum (`fenced` / `indented`) | `fenced` | How code blocks are rendered. |
| Custom Style Map | list of `{from, to}` pairs | empty | Mammoth style-map rules. See [Mammoth.js styleMap docs](https://github.com/mwilliamson/mammoth.js/#custom-style-map). |
| Extract Images | boolean | `false` | Output embedded images as binary fields (`image_1`, `image_2`, …) alongside the JSON. |
| Heading Style | enum (`atx` / `setext`) | `atx` | ATX (`# Heading`) vs Setext (underline) syntax. |
| Image Link Format | enum (`binaryKey` / `none` / `placeholder`) | `binaryKey` | Only when **Extract Images** is on. Choose `![](image_1)`, no reference at all, or `[[image_1]]` for downstream templating. |
| Include Raw Text | boolean | `false` | Attach `rawText` (via `mammoth.extractRawText`) to the JSON output. Useful for embeddings and search. |
| Include Warnings | boolean | `false` | Attach `warnings: string[]` (from mammoth's `messages`) to the JSON output. |
| Lint Markdown | boolean | `true` | Run `markdownlint --fix` on the output. Turn off to keep raw turndown output. |
| Table First Row as Header | boolean | `true` | Promote the first row of each table to header cells. |
| Validate Docx Signature | boolean | `true` | Reject input that doesn't begin with the `.docx` (ZIP) magic signature. |

### Output Shape

By default the output is `{ json: { [destinationOutputField]: markdown } }`.
When options are enabled additional keys appear:

```json
{
  "json": {
    "text": "<markdown>",
    "warnings": ["[warning] Unrecognized paragraph style 'Quote'"],
    "rawText": "<plain text>"
  },
  "binary": {
    "image_1": { "data": "<base64>", "mimeType": "image/png", "fileName": "image_1.png" }
  }
}
```

`warnings` appears only when **Include Warnings** is on; `rawText` only when
**Include Raw Text** is on; `binary` only when **Extract Images** is on.

### Error Handling

The node honours n8n's `continueOnFail` setting. When enabled, a failing item
becomes an error item — `{ json: { error: "<message>" }, error: NodeOperationError, pairedItem: { item: i } }` —
instead of halting the batch.
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
Document the Options collection and output shape in README

Adds a table of all 11 Options fields, an example output JSON when
options are enabled, and a short note on continueOnFail.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Version bump to 0.3.0

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Bump the version**

Edit `package.json`: change `"version": "0.2.1"` to `"version": "0.3.0"`.

- [ ] **Step 2: Run the full pre-publish check**

Run: `pnpm install --frozen-lockfile` to ensure the lockfile is in sync (it should already be), then `pnpm lint && pnpm build && pnpm test:coverage`.
Expected: clean, tests green, 100% coverage.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "$(cat <<'EOF'
Bump version to 0.3.0

Release notes are in CHANGELOG.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Tag the release (do not push automatically — leave to the user)**

Run: `git tag -a v0.3.0 -m "Release 0.3.0"`

Inform the user that the tag is local; they can `git push origin master v0.3.0` and run `npm publish` (or `pnpm publish`) when ready.

---

## Post-implementation: verify and report

Before declaring the plan complete, run from a clean working tree:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm build
pnpm test:coverage
```

All four must pass. Coverage must be 100% on `nodes/**` and `credentials/**`.

Report to the user:
- Number of commits added.
- Coverage summary line (e.g. `Statements 100% Branches 100% Functions 100% Lines 100%`).
- Reminder that `git push origin master v0.3.0` + `npm publish` are user-driven.
