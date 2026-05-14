# v0.4.0 RAG Positioning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v0.4.0 — introduce `VersionedNodeType` (v1 frozen, v2 new) with a `Resource/Operation` UI, and add an `Extract for RAG` operation that emits LangChain `Document`-shaped chunks (N items per chunk) with docx metadata, heading path, and configurable chunking.

**Architecture:** Split today's `nodes/DocxToMd/DocxToMd.node.ts` into a `VersionedNodeType` wrapper plus `v1/` (frozen) and `v2/` (active) subfolders. Move all conversion helpers to `nodes/DocxToMd/shared/convert.ts`. Add three new shared modules: `shared/metadata.ts` (read `docProps/core.xml` + `app.xml` via JSZip), `shared/headings.ts` (parse heading hierarchy), `shared/chunking.ts` (three split strategies). The new `Extract for RAG` operation chains them.

**Tech Stack:** TypeScript 5.8, Jest 29 + babel-jest, n8n-workflow `VersionedNodeType`, mammoth, `@joplin/turndown`, markdownlint, JSZip (promoted from dev), node-html-parser, pnpm 9.

**Spec reference:** `docs/superpowers/specs/2026-05-14-rag-positioning-design.md`

**Note on test placement:** Shared modules get their own test files (`tests/shared/*.test.ts`). Operation-level integration tests sit beside the existing `tests/convert.test.ts` and `tests/DocxToMd.node.test.ts` patterns. New test file: `tests/v1Snapshot.test.ts` that locks v1 output against committed golden strings, so future refactors of the shared helpers can't silently change v0.3.0 output.

---

## Task 1: Move conversion helpers to `shared/convert.ts`; lock v1 output via snapshot tests; introduce `VersionedNodeType` wrapper with only v1

This task is intentionally one big refactor — splitting it would leave the tree in a broken intermediate state. The goal: zero behavioural change. All 81 existing tests continue to pass; a new snapshot test pins v1 output for the future.

**Files:**
- Create: `nodes/DocxToMd/shared/convert.ts`
- Create: `nodes/DocxToMd/v1/DocxToMdV1.node.ts`
- Modify: `nodes/DocxToMd/DocxToMd.node.ts` (becomes wrapper)
- Modify: `nodes/DocxToMd/types.d.ts` (stays; check it's still applicable to new paths)
- Modify: every test under `tests/` that imports from `../nodes/DocxToMd/DocxToMd.node` — the same names re-export from the new wrapper or `shared/convert`
- Create: `tests/v1Snapshot.test.ts`
- Create: `tests/fixtures/snapshots/simple.md`, `tests/fixtures/snapshots/with-table.md`, `tests/fixtures/snapshots/with-image.md`, `tests/fixtures/snapshots/with-custom-style.md`

### Step 1: Write the snapshot test (one-time-record pattern)

Snapshots get recorded the first time the test runs (the pre-refactor state) and asserted on every run thereafter — including post-refactor and post-shared-module-changes.

Create `tests/v1Snapshot.test.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { convert } from '../nodes/DocxToMd/DocxToMd.node';

const FIXTURES = path.join(__dirname, 'fixtures');
const SNAPSHOTS = path.join(FIXTURES, 'snapshots');

describe('v1 output snapshot', () => {
	const fixtures = ['simple', 'with-table', 'with-image', 'with-custom-style'];

	beforeAll(() => {
		fs.mkdirSync(SNAPSHOTS, { recursive: true });
	});

	for (const name of fixtures) {
		it(`v0.3.0-identical output for ${name}.docx`, async () => {
			const actual = await convert(path.join(FIXTURES, `${name}.docx`));
			const snapPath = path.join(SNAPSHOTS, `${name}.md`);
			if (!fs.existsSync(snapPath)) {
				fs.writeFileSync(snapPath, actual);
				console.warn(`[snapshot recorded] ${snapPath} — commit this file`);
			}
			const expected = fs.readFileSync(snapPath, 'utf-8');
			expect(actual).toBe(expected);
		});
	}
});
```

### Step 2: Run the test to record snapshots

Run: `pnpm test -- --testPathPattern v1Snapshot`
Expected: 4 passes, with 4 `[snapshot recorded]` warnings on stderr. Four `.md` files now exist under `tests/fixtures/snapshots/`.

### Step 3: Sanity-check the recorded snapshots

Inspect each file briefly:

```bash
ls -la tests/fixtures/snapshots/
wc -c tests/fixtures/snapshots/*.md
head -3 tests/fixtures/snapshots/simple.md
```

Each file should be non-empty (≥100 bytes for simple, more for others) and look like valid Markdown.

If the snapshots look wrong, delete them and investigate before continuing. Once they look right, they are the v0.3.0 contract.

### Step 4: Create `shared/convert.ts`

Move the entire body of `nodes/DocxToMd/DocxToMd.node.ts` EXCEPT the `DocxToMd` class into `nodes/DocxToMd/shared/convert.ts`. That is:

- Imports (turndown, mammoth, markdownlint, node-html-parser)
- Type interfaces (`ConvertOptions`, `ConvertVerboseResult`, `ExtractedImage`)
- Helper functions (`extensionFor`, `hasZipSignature`, `buildStyleMapString`, `autoTableHeaders`, `htmlToMd`, `htmlToMdWithImageRule`, `lint`)
- The `convert`, `convertVerbose` functions

Keep every export name identical (`export function convert`, `export interface ConvertOptions`, …).

The new `nodes/DocxToMd/types.d.ts` already declares the modules; move it to `nodes/DocxToMd/shared/types.d.ts` so the declarations resolve from the new file's location. Update the import in `tsconfig.json` if any explicit reference exists (likely none).

### Step 5: Create `v1/DocxToMdV1.node.ts` by cloning the current class

Run, from the repo root:

```bash
cp nodes/DocxToMd/DocxToMd.node.ts nodes/DocxToMd/v1/DocxToMdV1.node.ts
```

Then make these mechanical edits to `nodes/DocxToMd/v1/DocxToMdV1.node.ts` (and only these):

a. **Delete the helper code that now lives in `shared/convert.ts`.** That means: every type interface (`ConvertOptions`, `ConvertVerboseResult`, `ExtractedImage`), the `defaultTurndownOptions` const, the entire helper functions `extensionFor`, `hasZipSignature`, `buildStyleMapString`, `autoTableHeaders`, `htmlToMd`, `htmlToMdWithImageRule`, `lint`, `convert`, `convertVerbose`. Also delete the `import * as mammoth from 'mammoth'` and the `TurndownService` / `turndownPluginGfm` / `markdownlintSync` / `markdownlint` / `node-html-parser` imports that supported them.

b. **Add one import line** for the helpers v1 actually uses:

```ts
import {
	ConvertOptions,
	convertVerbose,
	hasZipSignature,
	buildStyleMapString,
} from '../shared/convert';
```

c. **Add `INodeTypeBaseDescription` to the existing n8n-workflow import** alongside `IDataObject`, `IExecuteFunctions`, `INodeExecutionData`, `INodeType`, `INodeTypeDescription`.

d. **Rename the class** from `export class DocxToMd implements INodeType` to `export class DocxToMdV1 implements INodeType`.

e. **Convert the `description` from a field initialiser to a constructor argument.** Replace the existing `description: INodeTypeDescription = { ... };` line with this pattern (the contents of the `properties` array are unchanged — keep all 4 top-level fields and the 11-field Options collection exactly as they are in the current `DocxToMd.node.ts`):

```ts
description: INodeTypeDescription;

constructor(baseDescription: INodeTypeBaseDescription) {
	this.description = {
		...baseDescription,
		version: 1,
		defaults: { name: 'Docx to Markdown' },
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
		usableAsTool: true,
		properties: [
			// ← LEAVE THE ENTIRE EXISTING `properties` ARRAY HERE.
			// Copy it from the cp'd file as-is; do not edit a single character.
		],
	};
}
```

The `properties` array is the same one you just copied via `cp`. Visually, this step removes `displayName: 'Docx to Markdown'`, `name: 'docxToMd'`, `icon: 'file:docxtomd.svg'`, `group: ['transform']`, and `description: 'Converts Docx file to Markdown'` from `description` (they come from `baseDescription` now); it inserts `...baseDescription` and `version: 1`; everything else stays.

f. **Do not change `async execute(this: IExecuteFunctions)`.** The method body is identical to what was in `DocxToMd.node.ts`. Helpers like `convertVerbose`, `hasZipSignature`, `buildStyleMapString` now resolve via the new import.

### Step 6: Rewrite the registered `DocxToMd.node.ts` as a VersionedNodeType wrapper

Full file:

```ts
import type { INodeTypeBaseDescription, IVersionedNodeType } from 'n8n-workflow';
import { VersionedNodeType } from 'n8n-workflow';
import { DocxToMdV1 } from './v1/DocxToMdV1.node';

export class DocxToMd extends VersionedNodeType {
	constructor() {
		const baseDescription: INodeTypeBaseDescription = {
			displayName: 'Docx to Markdown',
			name: 'docxToMd',
			icon: 'file:docxtomd.svg',
			group: ['transform'],
			defaultVersion: 1,
			description: 'Converts Docx file to Markdown',
		};

		const nodeVersions: IVersionedNodeType['nodeVersions'] = {
			1: new DocxToMdV1(baseDescription),
		};

		super(nodeVersions, baseDescription);
	}
}

// Re-exports kept for existing test imports. These will continue to work as
// long as tests do `import { convert } from '../nodes/DocxToMd/DocxToMd.node'`.
export {
	autoTableHeaders,
	convert,
	convertVerbose,
	htmlToMd,
	lint,
	hasZipSignature,
	buildStyleMapString,
} from './shared/convert';
export type {
	ConvertOptions,
	ConvertVerboseResult,
	ExtractedImage,
} from './shared/convert';
```

`defaultVersion: 1` for this task. Task 6 will flip it to `2`.

### Step 7: Run the full suite

Run: `pnpm test:coverage`
Expected: all 85 tests pass (81 + 4 snapshot). 100/100/100/100.

If a test fails because an import path resolution changed, fix the test's import to use the re-exports from `DocxToMd.node`. Do NOT change test behaviour.

### Step 8: Run the build

Run: `pnpm build`
Expected: `dist/` rebuilds clean. The registered file is still `dist/nodes/DocxToMd/DocxToMd.node.js`; `package.json`'s `n8n.nodes` array does not need to change.

### Step 9: Commit

```bash
git add nodes/DocxToMd/ tests/v1Snapshot.test.ts tests/fixtures/snapshots/
git commit -m "$(cat <<'EOF'
Split DocxToMd into VersionedNodeType wrapper with frozen v1

Moves all conversion helpers to nodes/DocxToMd/shared/convert.ts and
the v0.3.0 node body to nodes/DocxToMd/v1/DocxToMdV1.node.ts. The
registered node is now a thin VersionedNodeType wrapper. Adds a
snapshot test (tests/v1Snapshot.test.ts plus committed golden strings
in tests/fixtures/snapshots/) so future shared-module changes cannot
silently shift v1 output.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `shared/metadata.ts` — parse `docProps/core.xml` and `app.xml`

**Files:**
- Create: `nodes/DocxToMd/shared/metadata.ts`
- Create: `tests/shared/metadata.test.ts`

### Step 1: Write the failing tests

Create `tests/shared/metadata.test.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { extractDocxMetadata } from '../../nodes/DocxToMd/shared/metadata';

const FIXTURES = path.join(__dirname, '..', 'fixtures');

describe('extractDocxMetadata', () => {
	it('returns an empty object for a fixture with no metadata', async () => {
		const buf = fs.readFileSync(path.join(FIXTURES, 'simple.docx'));
		const meta = await extractDocxMetadata(buf);
		// Our test fixtures do not include docProps/core.xml or app.xml, so we
		// expect all fields to be absent rather than null.
		expect(meta).toEqual({});
	});

	it('parses core.xml fields when present', async () => {
		const buf = await buildDocxWithCore({
			title: 'Q3 Strategy',
			creator: 'Alice',
			lastModifiedBy: 'Bob',
			created: '2026-03-15T10:00:00Z',
			modified: '2026-04-20T14:33:00Z',
			revision: '12',
		});
		const meta = await extractDocxMetadata(buf);
		expect(meta).toMatchObject({
			title: 'Q3 Strategy',
			author: 'Alice',
			lastModifiedBy: 'Bob',
			createdAt: '2026-03-15T10:00:00Z',
			modifiedAt: '2026-04-20T14:33:00Z',
			revision: 12,
		});
	});

	it('parses app.xml counts when present', async () => {
		const buf = await buildDocxWithApp({
			words: '4831',
			characters: '28912',
			pages: '18',
		});
		const meta = await extractDocxMetadata(buf);
		expect(meta).toMatchObject({
			wordCount: 4831,
			charCount: 28912,
			pageCount: 18,
		});
	});

	it('handles malformed XML gracefully', async () => {
		const buf = await buildDocxWithRawCore('<not valid xml');
		const meta = await extractDocxMetadata(buf);
		expect(meta).toEqual({});
	});
});

// Test helpers — build minimal docx zips on the fly using JSZip.
import JSZip from 'jszip';

async function buildDocxWithCore(fields: Record<string, string>): Promise<Buffer> {
	const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties
	xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
	xmlns:dc="http://purl.org/dc/elements/1.1/"
	xmlns:dcterms="http://purl.org/dc/terms/">
	<dc:title>${fields.title ?? ''}</dc:title>
	<dc:creator>${fields.creator ?? ''}</dc:creator>
	<cp:lastModifiedBy>${fields.lastModifiedBy ?? ''}</cp:lastModifiedBy>
	<dcterms:created xsi:type="dcterms:W3CDTF" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${fields.created ?? ''}</dcterms:created>
	<dcterms:modified xsi:type="dcterms:W3CDTF" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${fields.modified ?? ''}</dcterms:modified>
	<cp:revision>${fields.revision ?? ''}</cp:revision>
</cp:coreProperties>`;
	return buildDocxWithRawCore(core);
}

async function buildDocxWithRawCore(coreXml: string): Promise<Buffer> {
	const zip = new JSZip();
	zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types/>');
	zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships/>');
	zip.file('docProps/core.xml', coreXml);
	return zip.generateAsync({ type: 'nodebuffer' });
}

async function buildDocxWithApp(fields: Record<string, string>): Promise<Buffer> {
	const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
	<Words>${fields.words ?? '0'}</Words>
	<Characters>${fields.characters ?? '0'}</Characters>
	<Pages>${fields.pages ?? '0'}</Pages>
</Properties>`;
	const zip = new JSZip();
	zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types/>');
	zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships/>');
	zip.file('docProps/app.xml', app);
	return zip.generateAsync({ type: 'nodebuffer' });
}
```

### Step 2: Run, expect failure

Run: `pnpm test -- --testPathPattern shared/metadata`
Expected: module-not-found error.

### Step 3: Implement `shared/metadata.ts`

```ts
import JSZip from 'jszip';
import { parse } from 'node-html-parser';

export interface DocxMetadata {
	title?: string;
	author?: string;
	lastModifiedBy?: string;
	createdAt?: string;
	modifiedAt?: string;
	revision?: number;
	wordCount?: number;
	charCount?: number;
	pageCount?: number;
}

function textOf(root: ReturnType<typeof parse>, selector: string): string | undefined {
	const node = root.querySelector(selector);
	if (!node) return undefined;
	const text = node.text.trim();
	return text.length > 0 ? text : undefined;
}

function numberOf(root: ReturnType<typeof parse>, selector: string): number | undefined {
	const text = textOf(root, selector);
	if (text === undefined) return undefined;
	const n = Number(text);
	return Number.isFinite(n) ? n : undefined;
}

export async function extractDocxMetadata(input: Buffer | ArrayBuffer): Promise<DocxMetadata> {
	const result: DocxMetadata = {};
	let zip: JSZip;
	try {
		zip = await JSZip.loadAsync(input);
	} catch {
		return result;
	}

	const coreXml = await zip.file('docProps/core.xml')?.async('string');
	if (coreXml) {
		try {
			const root = parse(coreXml);
			const title = textOf(root, 'dc\\:title') ?? textOf(root, 'title');
			const author = textOf(root, 'dc\\:creator') ?? textOf(root, 'creator');
			const lastModifiedBy =
				textOf(root, 'cp\\:lastModifiedBy') ?? textOf(root, 'lastModifiedBy');
			const created = textOf(root, 'dcterms\\:created') ?? textOf(root, 'created');
			const modified = textOf(root, 'dcterms\\:modified') ?? textOf(root, 'modified');
			const revision = numberOf(root, 'cp\\:revision') ?? numberOf(root, 'revision');

			if (title) result.title = title;
			if (author) result.author = author;
			if (lastModifiedBy) result.lastModifiedBy = lastModifiedBy;
			if (created) result.createdAt = created;
			if (modified) result.modifiedAt = modified;
			if (revision !== undefined) result.revision = revision;
		} catch {
			/* swallow malformed core.xml */
		}
	}

	const appXml = await zip.file('docProps/app.xml')?.async('string');
	if (appXml) {
		try {
			const root = parse(appXml);
			const words = numberOf(root, 'Words');
			const chars = numberOf(root, 'Characters');
			const pages = numberOf(root, 'Pages');
			if (words !== undefined) result.wordCount = words;
			if (chars !== undefined) result.charCount = chars;
			if (pages !== undefined) result.pageCount = pages;
		} catch {
			/* swallow malformed app.xml */
		}
	}

	return result;
}
```

The `dc\\:title` selector is `node-html-parser`'s way to query a namespaced tag literally (it lowercases tags by default; double-backslash escapes the colon in the selector).

### Step 4: Run tests

Run: `pnpm test -- --testPathPattern shared/metadata`
Expected: 4 passes.

Run: `pnpm test:coverage`
Expected: all green, 100%. The new module is covered by its own tests.

### Step 5: Commit

```bash
git add nodes/DocxToMd/shared/metadata.ts tests/shared/metadata.test.ts
git commit -m "$(cat <<'EOF'
Add docx metadata extractor (shared/metadata.ts)

Parses docProps/core.xml (Dublin Core: title, author, dates, revision)
and docProps/app.xml (Words, Characters, Pages) from the docx ZIP via
JSZip. Returns a plain DocxMetadata object with each field absent when
unparseable or missing. Used by the upcoming Extract for RAG operation
to populate the per-chunk metadata.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `shared/headings.ts` — heading-path tracking through a Markdown document

**Files:**
- Create: `nodes/DocxToMd/shared/headings.ts`
- Create: `tests/shared/headings.test.ts`

### Step 1: Write the failing tests

Create `tests/shared/headings.test.ts`:

```ts
import { buildHeadingIndex, headingPathAt } from '../../nodes/DocxToMd/shared/headings';

describe('buildHeadingIndex', () => {
	it('records each heading with its line and level', () => {
		const md = ['# A', 'p1', '## B', 'p2', '### C', 'p3', '# D'].join('\n');
		const idx = buildHeadingIndex(md);
		expect(idx).toEqual([
			{ level: 1, text: 'A', line: 0 },
			{ level: 2, text: 'B', line: 2 },
			{ level: 3, text: 'C', line: 4 },
			{ level: 1, text: 'D', line: 6 },
		]);
	});

	it('ignores hash characters inside fenced code blocks', () => {
		const md = ['# Real', '```', '# Fake', '```', '## Real Too'].join('\n');
		const idx = buildHeadingIndex(md);
		expect(idx).toEqual([
			{ level: 1, text: 'Real', line: 0 },
			{ level: 2, text: 'Real Too', line: 4 },
		]);
	});

	it('treats indented hashes as not-a-heading', () => {
		const md = ['# Real', '    # Indented', 'plain'].join('\n');
		const idx = buildHeadingIndex(md);
		expect(idx).toEqual([{ level: 1, text: 'Real', line: 0 }]);
	});
});

describe('headingPathAt', () => {
	const md = ['# A', 'p1', '## B', 'p2', '### C', 'p3', '# D', 'p4'].join('\n');
	const idx = buildHeadingIndex(md);

	it('returns the stack of ancestors active at a given line', () => {
		expect(headingPathAt(idx, 1)).toEqual(['A']);
		expect(headingPathAt(idx, 3)).toEqual(['A', 'B']);
		expect(headingPathAt(idx, 5)).toEqual(['A', 'B', 'C']);
		expect(headingPathAt(idx, 7)).toEqual(['D']);
	});

	it('returns an empty path before the first heading', () => {
		const earlyIdx = buildHeadingIndex('plain text\n# A');
		expect(headingPathAt(earlyIdx, 0)).toEqual([]);
	});

	it('pops siblings correctly (H1 → H2 → H1 → H2)', () => {
		const m = ['# A', '## A1', '# B', '## B1'].join('\n');
		const i = buildHeadingIndex(m);
		expect(headingPathAt(i, 3)).toEqual(['B', 'B1']);
	});
});
```

### Step 2: Run, expect failure

Run: `pnpm test -- --testPathPattern shared/headings`
Expected: module-not-found.

### Step 3: Implement `shared/headings.ts`

```ts
export interface HeadingEntry {
	level: number; // 1-6
	text: string;
	line: number; // 0-based line number in the source markdown
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;

export function buildHeadingIndex(markdown: string): HeadingEntry[] {
	const lines = markdown.split('\n');
	const out: HeadingEntry[] = [];
	let inFence = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		// Toggle fenced-code-block tracking on lines that *start* with ``` or ~~~
		// at column 0 (no indent). This matches CommonMark fenced code block rules.
		if (/^(```|~~~)/.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		const m = line.match(HEADING_RE);
		if (!m) continue;
		out.push({ level: m[1].length, text: m[2], line: i });
	}
	return out;
}

export function headingPathAt(index: HeadingEntry[], line: number): string[] {
	const stack: HeadingEntry[] = [];
	for (const entry of index) {
		if (entry.line > line) break;
		while (stack.length > 0 && stack[stack.length - 1].level >= entry.level) {
			stack.pop();
		}
		stack.push(entry);
	}
	return stack.map((e) => e.text);
}
```

### Step 4: Run, confirm passing

Run: `pnpm test -- --testPathPattern shared/headings`
Expected: all green.

Run: `pnpm test:coverage`
Expected: 100% maintained.

### Step 5: Commit

```bash
git add nodes/DocxToMd/shared/headings.ts tests/shared/headings.test.ts
git commit -m "$(cat <<'EOF'
Add heading-index builder and path resolver (shared/headings.ts)

Parses Markdown to a flat list of {level, text, line}, skipping
fenced code blocks. headingPathAt(index, line) returns the active
heading stack at any line — used by the upcoming Extract for RAG
operation to attach a headingPath to every chunk's metadata.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `shared/chunking.ts` — recursive split strategy

The `recursive` strategy is the building block for `markdownHeader` (Task 6) and the simplest of the three, so it lands first.

**Files:**
- Create: `nodes/DocxToMd/shared/chunking.ts`
- Create: `tests/shared/chunking.test.ts`

### Step 1: Write the failing tests for `recursive`

Create `tests/shared/chunking.test.ts`:

```ts
import { recursiveSplit } from '../../nodes/DocxToMd/shared/chunking';

describe('recursiveSplit', () => {
	it('returns a single chunk for short input', () => {
		const chunks = recursiveSplit('Hello world.', { chunkSize: 100, chunkOverlap: 0 });
		expect(chunks).toHaveLength(1);
		expect(chunks[0].text).toBe('Hello world.');
		expect(chunks[0].position).toEqual({ start: 0, end: 12 });
	});

	it('splits on paragraph boundaries when possible', () => {
		const para = 'word '.repeat(20).trim(); // ~99 chars
		const md = [para, para, para].join('\n\n');
		const chunks = recursiveSplit(md, { chunkSize: 110, chunkOverlap: 0 });
		// Three paragraphs at ~99 chars each, target 110, no overlap.
		// Expect three chunks aligning roughly with paragraph boundaries.
		expect(chunks.length).toBeGreaterThanOrEqual(3);
		for (const c of chunks) {
			expect(c.text.length).toBeLessThanOrEqual(110);
		}
	});

	it('falls through to line boundaries when paragraphs are oversize', () => {
		const longPara = ['line1', 'line2', 'line3', 'line4'].join('\n');
		const chunks = recursiveSplit(longPara, { chunkSize: 10, chunkOverlap: 0 });
		expect(chunks.length).toBeGreaterThanOrEqual(2);
	});

	it('applies overlap between adjacent chunks', () => {
		const md = 'a'.repeat(100);
		const chunks = recursiveSplit(md, { chunkSize: 30, chunkOverlap: 5 });
		// Adjacent chunks should share at least one character at the boundary.
		for (let i = 0; i < chunks.length - 1; i++) {
			const tail = chunks[i].text.slice(-5);
			const head = chunks[i + 1].text.slice(0, 5);
			expect(tail).toBe(head);
		}
	});

	it('preserves the original char positions in `position`', () => {
		const md = 'AAAA\n\nBBBB\n\nCCCC';
		const chunks = recursiveSplit(md, { chunkSize: 5, chunkOverlap: 0 });
		// Verify the first chunk's slice matches its position.
		expect(md.slice(chunks[0].position.start, chunks[0].position.end)).toBe(chunks[0].text);
	});
});
```

### Step 2: Run, expect failure

Run: `pnpm test -- --testPathPattern shared/chunking`
Expected: module-not-found.

### Step 3: Implement `recursiveSplit`

Create `nodes/DocxToMd/shared/chunking.ts`:

```ts
export interface Chunk {
	text: string;
	position: { start: number; end: number };
}

export interface ChunkOptions {
	chunkSize: number;
	chunkOverlap: number;
}

const SEPARATORS = ['\n\n', '\n', '. ', ' ', ''];

export function recursiveSplit(text: string, opts: ChunkOptions): Chunk[] {
	const pieces = splitToPieces(text, 0, opts.chunkSize, SEPARATORS, 0);
	if (opts.chunkOverlap <= 0) return pieces;
	return applyOverlap(text, pieces, opts.chunkOverlap);
}

function splitToPieces(
	text: string,
	textStart: number,
	chunkSize: number,
	separators: string[],
	sepIndex: number,
): Chunk[] {
	if (text.length <= chunkSize) {
		return text.length === 0
			? []
			: [{ text, position: { start: textStart, end: textStart + text.length } }];
	}
	if (sepIndex >= separators.length) {
		// Hard split at chunkSize boundary (handles the empty-string separator case).
		const out: Chunk[] = [];
		for (let i = 0; i < text.length; i += chunkSize) {
			const slice = text.slice(i, i + chunkSize);
			out.push({ text: slice, position: { start: textStart + i, end: textStart + i + slice.length } });
		}
		return out;
	}
	const sep = separators[sepIndex];
	if (sep === '') {
		return splitToPieces(text, textStart, chunkSize, separators, sepIndex + 1);
	}
	const parts = text.split(sep);
	if (parts.length === 1) {
		return splitToPieces(text, textStart, chunkSize, separators, sepIndex + 1);
	}
	const out: Chunk[] = [];
	let cursor = 0;
	let buffer = '';
	let bufferStart = textStart;
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		const partWithSep = i < parts.length - 1 ? part + sep : part;
		if (buffer.length === 0) {
			bufferStart = textStart + cursor;
		}
		const candidate = buffer + partWithSep;
		if (candidate.length <= chunkSize) {
			buffer = candidate;
		} else {
			if (buffer.length > 0) {
				out.push({ text: buffer, position: { start: bufferStart, end: bufferStart + buffer.length } });
			}
			// Single part too big — recurse on it.
			if (partWithSep.length > chunkSize) {
				const inner = splitToPieces(
					partWithSep,
					textStart + cursor,
					chunkSize,
					separators,
					sepIndex + 1,
				);
				out.push(...inner);
				buffer = '';
			} else {
				buffer = partWithSep;
				bufferStart = textStart + cursor;
			}
		}
		cursor += partWithSep.length;
	}
	if (buffer.length > 0) {
		out.push({ text: buffer, position: { start: bufferStart, end: bufferStart + buffer.length } });
	}
	return out;
}

function applyOverlap(text: string, pieces: Chunk[], overlap: number): Chunk[] {
	if (pieces.length <= 1) return pieces;
	return pieces.map((p, i) => {
		if (i === 0) return p;
		const overlapStart = Math.max(0, p.position.start - overlap);
		return {
			text: text.slice(overlapStart, p.position.end),
			position: { start: overlapStart, end: p.position.end },
		};
	});
}
```

### Step 4: Run, expect green

Run: `pnpm test -- --testPathPattern shared/chunking`
Expected: all 5 tests pass.

Run: `pnpm test:coverage`
Expected: 100%. If branches are uncovered (e.g. the empty-string separator fallthrough), add a targeted test that forces that path — e.g. a string with no separators at all that exceeds chunkSize.

### Step 5: Commit

```bash
git add nodes/DocxToMd/shared/chunking.ts tests/shared/chunking.test.ts
git commit -m "$(cat <<'EOF'
Add recursive split strategy (shared/chunking.ts)

Implements LangChain-style RecursiveCharacterTextSplitter: tries
paragraph, line, sentence, word, and char separators in order. Returns
Chunk objects with the original char position preserved. Applies a
configurable overlap window after splitting.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `chunking.ts` — `fixed` (sliding window) strategy

**Files:**
- Modify: `nodes/DocxToMd/shared/chunking.ts`
- Modify: `tests/shared/chunking.test.ts`

### Step 1: Write the failing tests

Append to `tests/shared/chunking.test.ts`:

```ts
import { fixedSplit } from '../../nodes/DocxToMd/shared/chunking';

describe('fixedSplit', () => {
	it('produces fixed-size chunks with overlap', () => {
		const md = 'a'.repeat(100);
		const chunks = fixedSplit(md, { chunkSize: 30, chunkOverlap: 10 });
		// step = 30 - 10 = 20. chunks: [0..30], [20..50], [40..70], [60..90], [80..100].
		expect(chunks).toHaveLength(5);
		expect(chunks[0].position).toEqual({ start: 0, end: 30 });
		expect(chunks[1].position).toEqual({ start: 20, end: 50 });
		expect(chunks[4].text).toHaveLength(20);
	});

	it('returns one chunk for input shorter than chunkSize', () => {
		const chunks = fixedSplit('hello', { chunkSize: 100, chunkOverlap: 10 });
		expect(chunks).toHaveLength(1);
		expect(chunks[0].text).toBe('hello');
	});

	it('handles zero overlap', () => {
		const chunks = fixedSplit('abcdefghij', { chunkSize: 3, chunkOverlap: 0 });
		expect(chunks.map((c) => c.text)).toEqual(['abc', 'def', 'ghi', 'j']);
	});
});
```

### Step 2: Run, expect failure

Run: `pnpm test -- --testPathPattern shared/chunking`
Expected: import error — `fixedSplit` not exported.

### Step 3: Implement `fixedSplit`

Append to `nodes/DocxToMd/shared/chunking.ts`:

```ts
export function fixedSplit(text: string, opts: ChunkOptions): Chunk[] {
	if (text.length <= opts.chunkSize) {
		return text.length === 0 ? [] : [{ text, position: { start: 0, end: text.length } }];
	}
	const step = Math.max(1, opts.chunkSize - opts.chunkOverlap);
	const out: Chunk[] = [];
	for (let i = 0; i < text.length; i += step) {
		const end = Math.min(i + opts.chunkSize, text.length);
		out.push({ text: text.slice(i, end), position: { start: i, end } });
		if (end === text.length) break;
	}
	return out;
}
```

### Step 4: Run, confirm green

Run: `pnpm test -- --testPathPattern shared/chunking`
Expected: all tests pass.

Run: `pnpm test:coverage`
Expected: 100%.

### Step 5: Commit

```bash
git add nodes/DocxToMd/shared/chunking.ts tests/shared/chunking.test.ts
git commit -m "$(cat <<'EOF'
Add fixed (sliding window) split strategy

Simple stride-based splitter: step = chunkSize - chunkOverlap. Useful
for unstructured text where recursive boundary-finding is not helpful.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `chunking.ts` — `markdownHeader` strategy

The default strategy: split on H1/H2/H3 boundaries; within each section, fall back to recursive splitting if oversized.

**Files:**
- Modify: `nodes/DocxToMd/shared/chunking.ts`
- Modify: `tests/shared/chunking.test.ts`

### Step 1: Write the failing tests

Append to `tests/shared/chunking.test.ts`:

```ts
import { markdownHeaderSplit } from '../../nodes/DocxToMd/shared/chunking';

describe('markdownHeaderSplit', () => {
	it('splits on H1/H2/H3 boundaries', () => {
		const md = ['# A', 'aaa', '## B', 'bbb', '# C', 'ccc'].join('\n');
		const chunks = markdownHeaderSplit(md, { chunkSize: 1000, chunkOverlap: 0 });
		expect(chunks).toHaveLength(3);
		expect(chunks[0].text).toContain('# A');
		expect(chunks[0].text).toContain('aaa');
		expect(chunks[1].text).toContain('## B');
		expect(chunks[2].text).toContain('# C');
	});

	it('keeps H4-H6 within their parent section', () => {
		const md = ['# A', '#### deep', 'body'].join('\n');
		const chunks = markdownHeaderSplit(md, { chunkSize: 1000, chunkOverlap: 0 });
		expect(chunks).toHaveLength(1);
		expect(chunks[0].text).toContain('#### deep');
	});

	it('recurses into oversized sections', () => {
		const bigBody = 'a'.repeat(500);
		const md = `# Big\n${bigBody}`;
		const chunks = markdownHeaderSplit(md, { chunkSize: 200, chunkOverlap: 0 });
		expect(chunks.length).toBeGreaterThan(1);
		for (const c of chunks) {
			expect(c.text.length).toBeLessThanOrEqual(200);
		}
	});

	it('returns a single chunk when the doc has no heading', () => {
		const md = 'plain plain plain';
		const chunks = markdownHeaderSplit(md, { chunkSize: 1000, chunkOverlap: 0 });
		expect(chunks).toHaveLength(1);
		expect(chunks[0].text).toBe(md);
	});
});
```

### Step 2: Run, expect failure

Run: `pnpm test -- --testPathPattern shared/chunking`
Expected: import error.

### Step 3: Implement `markdownHeaderSplit`

Append to `nodes/DocxToMd/shared/chunking.ts`:

```ts
const SPLIT_HEADING_RE = /^(#{1,3})\s+/; // H1-H3 only

export function markdownHeaderSplit(text: string, opts: ChunkOptions): Chunk[] {
	const lines = text.split('\n');
	const sections: Array<{ start: number; end: number }> = [];
	let sectionStart = 0;
	let charCursor = 0;
	let inFence = false;
	const lineStarts: number[] = [];
	let acc = 0;
	for (const line of lines) {
		lineStarts.push(acc);
		acc += line.length + 1; // +1 for '\n'
	}
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (/^(```|~~~)/.test(line)) inFence = !inFence;
		if (inFence) continue;
		if (i > 0 && SPLIT_HEADING_RE.test(line)) {
			sections.push({ start: sectionStart, end: lineStarts[i] - 1 });
			sectionStart = lineStarts[i];
		}
	}
	sections.push({ start: sectionStart, end: text.length });

	const out: Chunk[] = [];
	for (const sec of sections) {
		const sectionText = text.slice(sec.start, sec.end);
		if (sectionText.length === 0) continue;
		if (sectionText.length <= opts.chunkSize) {
			out.push({ text: sectionText, position: { start: sec.start, end: sec.end } });
			continue;
		}
		const inner = recursiveSplit(sectionText, opts);
		for (const c of inner) {
			out.push({
				text: c.text,
				position: { start: sec.start + c.position.start, end: sec.start + c.position.end },
			});
		}
	}
	return out;
}
```

### Step 4: Run, confirm green

Run: `pnpm test -- --testPathPattern shared/chunking`
Expected: all tests pass.

Run: `pnpm test:coverage`
Expected: 100%.

### Step 5: Commit

```bash
git add nodes/DocxToMd/shared/chunking.ts tests/shared/chunking.test.ts
git commit -m "$(cat <<'EOF'
Add markdownHeader split strategy (default for Extract for RAG)

Splits on H1/H2/H3 boundaries (H4-H6 stay inside the parent section
and influence only the headingPath metadata downstream). Sections
larger than chunkSize fall through to recursiveSplit. Skips fenced
code blocks when scanning for heading lines.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Add `with-multiple-headings.docx` fixture

**Files:**
- Modify: `tests/fixtures/build-fixtures.js`
- Create: `tests/fixtures/with-multiple-headings.docx` (generated)

### Step 1: Add the fixture body

In `tests/fixtures/build-fixtures.js`, define a new body and call `buildDocx`:

```js
const HEADINGS_BODY = `
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Introduction</w:t></w:r></w:p>
<w:p><w:r><w:t>Intro paragraph one.</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Background</w:t></w:r></w:p>
<w:p><w:r><w:t>Background details.</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Motivation</w:t></w:r></w:p>
<w:p><w:r><w:t>Why we built this.</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Methods</w:t></w:r></w:p>
<w:p><w:r><w:t>Methods overview.</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Approach</w:t></w:r></w:p>
<w:p><w:r><w:t>Our approach uses X and Y.</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t>Step one</w:t></w:r></w:p>
<w:p><w:r><w:t>First step description.</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t>Step two</w:t></w:r></w:p>
<w:p><w:r><w:t>Second step description.</w:t></w:r></w:p>
`;
```

In the IIFE at the bottom, add:

```js
await buildDocx('with-multiple-headings.docx', HEADINGS_BODY);
```

### Step 2: Generate the fixture

Run: `pnpm build:fixtures`
Expected: console output reports the new file.

### Step 3: Commit

```bash
git add tests/fixtures/build-fixtures.js tests/fixtures/with-multiple-headings.docx
git commit -m "$(cat <<'EOF'
Add with-multiple-headings.docx fixture

Six-section document with mixed H1/H2/H3 nesting, for testing the
markdownHeader chunking strategy and headingPath construction.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: v2 scaffolding — `DocxToMdV2` with Resource/Operation UI and `Convert` operation

This task introduces the v2 class with a `Resource` (Document) and one Operation (`Convert`). The Convert operation is a one-to-one port of v1's behaviour, restated under the new UI scaffolding so that future operations can land beside it. Wire it into `DocxToMd.node.ts` as version `2`, but keep `defaultVersion: 1` (v2 is not yet default until Task 9 wires the second operation).

**Files:**
- Create: `nodes/DocxToMd/v2/DocxToMdV2.node.ts`
- Modify: `nodes/DocxToMd/DocxToMd.node.ts` (register v2)
- Create: `tests/v2/DocxToMdV2.test.ts`

### Step 1: Write the failing test

Create `tests/v2/DocxToMdV2.test.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { DocxToMdV2 } from '../../nodes/DocxToMd/v2/DocxToMdV2.node';

const FIXTURES = path.join(__dirname, '..', 'fixtures');

interface V2Params {
	resource: string;
	operation: string;
	inputBinaryField: string;
	destinationOutputField: string;
	removeImages: boolean;
	options: IDataObject;
}

function makeContext(params: V2Params, binaryBuffer: Buffer): IExecuteFunctions {
	const ctx = {
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name: keyof V2Params) => params[name],
		getNode: () => ({ name: 'Docx to Markdown', type: 'docxToMd', typeVersion: 2 }),
		continueOnFail: () => false,
		helpers: {
			getBinaryDataBuffer: async () => binaryBuffer,
			prepareBinaryData: async (data: Buffer, fileName: string, mimeType: string) => ({
				data: data.toString('base64'),
				mimeType,
				fileName,
			}),
		},
	};
	return ctx as unknown as IExecuteFunctions;
}

describe('DocxToMdV2 — Convert operation', () => {
	it('produces v0.3.0-identical Markdown for simple.docx', async () => {
		const simpleBuf = fs.readFileSync(path.join(FIXTURES, 'simple.docx'));
		const node = new DocxToMdV2({
			displayName: 'Docx to Markdown',
			name: 'docxToMd',
			icon: 'file:docxtomd.svg',
			group: ['transform'],
			defaultVersion: 2,
			description: 'Converts Docx file to Markdown',
		});
		const ctx = makeContext(
			{
				resource: 'document',
				operation: 'convert',
				inputBinaryField: 'data',
				destinationOutputField: 'text',
				removeImages: false,
				options: {},
			},
			simpleBuf,
		);
		const result = await node.execute.call(ctx);
		const expected = fs.readFileSync(
			path.join(FIXTURES, 'snapshots', 'simple.md'),
			'utf-8',
		);
		expect((result[0][0].json as { text: string }).text).toBe(expected);
	});

	it('exposes Document/Convert in the description', () => {
		const node = new DocxToMdV2({
			displayName: 'Docx to Markdown',
			name: 'docxToMd',
			icon: 'file:docxtomd.svg',
			group: ['transform'],
			defaultVersion: 2,
			description: 'Converts Docx file to Markdown',
		});
		const resource = node.description.properties.find((p) => p.name === 'resource');
		const operation = node.description.properties.find((p) => p.name === 'operation');
		expect(resource).toBeDefined();
		expect(operation).toBeDefined();
		const resourceOpts = (resource as { options?: Array<{ value: string }> }).options ?? [];
		expect(resourceOpts.some((o) => o.value === 'document')).toBe(true);
	});
});
```

### Step 2: Run, expect failure

Run: `pnpm test -- --testPathPattern v2/DocxToMdV2`
Expected: module-not-found.

### Step 3: Create `nodes/DocxToMd/v2/DocxToMdV2.node.ts`

```ts
import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeBaseDescription,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionType, NodeOperationError } from 'n8n-workflow';

import {
	ConvertOptions,
	convertVerbose,
	hasZipSignature,
	buildStyleMapString,
} from '../shared/convert';

export class DocxToMdV2 implements INodeType {
	description: INodeTypeDescription;

	constructor(baseDescription: INodeTypeBaseDescription) {
		this.description = {
			...baseDescription,
			version: 2,
			defaults: { name: 'Docx to Markdown' },
			inputs: [NodeConnectionType.Main],
			outputs: [NodeConnectionType.Main],
			usableAsTool: true,
			properties: [
				{
					displayName: 'Resource',
					name: 'resource',
					type: 'options',
					noDataExpression: true,
					options: [{ name: 'Document', value: 'document' }],
					default: 'document',
				},
				{
					displayName: 'Operation',
					name: 'operation',
					type: 'options',
					noDataExpression: true,
					displayOptions: { show: { resource: ['document'] } },
					options: [
						{
							name: 'Convert',
							value: 'convert',
							description: 'Convert the docx to a single Markdown string',
							action: 'Convert docx to Markdown',
						},
					],
					default: 'convert',
				},
				// === Convert operation fields ===
				{
					displayName: 'Input Binary Field',
					name: 'inputBinaryField',
					type: 'string',
					default: 'data',
					placeholder: 'Input binary field containing the Docx file',
					description: 'The name of the input binary field containing the Docx file',
					required: true,
					displayOptions: { show: { resource: ['document'], operation: ['convert'] } },
				},
				{
					displayName: 'Destination Output Field',
					name: 'destinationOutputField',
					type: 'string',
					default: 'text',
					placeholder: 'Destination output field for the converted Markdown text',
					description:
						'The name of the destination output field for the converted Markdown text',
					required: true,
					displayOptions: { show: { resource: ['document'], operation: ['convert'] } },
				},
				{
					displayName: 'Remove Images',
					name: 'removeImages',
					type: 'boolean',
					default: false,
					description:
						'Whether to strip images from the converted Markdown. Ignored when Options > Extract Images is on.',
					displayOptions: { show: { resource: ['document'], operation: ['convert'] } },
				},
				// === Options collection (see Step 3a below) ===
			],
		};
	}

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		if (resource !== 'document') {
			throw new NodeOperationError(this.getNode(), `Unknown resource: ${resource}`);
		}

		for (let i = 0; i < items.length; i++) {
			try {
				if (operation === 'convert') {
					await runConvert.call(this, i, returnData);
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, {
						itemIndex: i,
					});
				}
			} catch (err) {
				const wrapped =
					err instanceof NodeOperationError
						? err
						: new NodeOperationError(this.getNode(), err as Error, { itemIndex: i });
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (err as Error).message },
						error: wrapped,
						pairedItem: { item: i },
					});
				} else {
					throw wrapped;
				}
			}
		}

		return [returnData];
	}
}

// Convert operation — exact mirror of v1's execute() body, factored out so
// future operations (Extract for RAG, etc.) sit beside it cleanly.
async function runConvert(
	this: IExecuteFunctions,
	i: number,
	returnData: INodeExecutionData[],
): Promise<void> {
	const inputBinaryField = this.getNodeParameter('inputBinaryField', i) as string;
	const destinationOutputField = this.getNodeParameter('destinationOutputField', i) as string;
	const removeImages = this.getNodeParameter('removeImages', i) as boolean;
	const options = this.getNodeParameter('options', i, {}) as IDataObject;

	const binaryData = await this.helpers.getBinaryDataBuffer(i, inputBinaryField);
	if (!binaryData) {
		throw new NodeOperationError(
			this.getNode(),
			`No binary data found for field "${inputBinaryField}"`,
			{ itemIndex: i },
		);
	}

	const validateSig = options.validateDocxSignature !== false;
	if (validateSig && !hasZipSignature(binaryData)) {
		throw new NodeOperationError(
			this.getNode(),
			'Input is not a valid .docx file (expected ZIP signature PK\\x03\\x04)',
			{ itemIndex: i },
		);
	}

	const turndown: Record<string, unknown> = {};
	if (typeof options.headingStyle === 'string') turndown.headingStyle = options.headingStyle;
	if (typeof options.bulletListMarker === 'string') turndown.bulletListMarker = options.bulletListMarker;
	if (typeof options.codeBlockStyle === 'string') turndown.codeBlockStyle = options.codeBlockStyle;

	const mammothOpts: Record<string, unknown> = {};
	const styleMap = buildStyleMapString(options.customStyleMap);
	if (styleMap !== undefined) mammothOpts.styleMap = styleMap;

	const convertOptions: ConvertOptions = { removeImages, turndown };
	if (Object.keys(mammothOpts).length > 0) convertOptions.mammoth = mammothOpts;
	if (options.lintMarkdown === false) convertOptions.lint = false;
	if (options.tableFirstRowAsHeader === false) convertOptions.tableFirstRowAsHeader = false;
	if (options.includeRawText === true) convertOptions.rawText = true;
	if (options.extractImages === true) {
		convertOptions.extractImages = true;
		if (typeof options.imageLinkFormat === 'string') {
			convertOptions.imageLinkFormat =
				options.imageLinkFormat as ConvertOptions['imageLinkFormat'];
		}
	}

	const { markdown, warnings, rawText, images } = await convertVerbose(
		binaryData,
		convertOptions,
	);

	const jsonOut: IDataObject = { [destinationOutputField]: markdown };
	if (options.includeWarnings === true) jsonOut.warnings = warnings;
	if (options.includeRawText === true && rawText !== undefined) jsonOut.rawText = rawText;

	const item: INodeExecutionData = { json: jsonOut, pairedItem: { item: i } };

	if (options.extractImages === true && images && images.length > 0) {
		item.binary = {};
		for (const img of images) {
			const fileName = `${img.key}.${img.extension}`;
			item.binary[img.key] = await this.helpers.prepareBinaryData(
				img.buffer,
				fileName,
				img.mimeType,
			);
		}
	}

	returnData.push(item);
}
```

### Step 3a: Paste the Options collection from v1

Open `nodes/DocxToMd/v1/DocxToMdV1.node.ts`. Find the property entry whose `name` is `'options'` and `type` is `'collection'`. It's a single object with eleven sub-fields inside its `options` array.

Copy that entire entry (the whole `{ displayName: 'Options', name: 'options', ... }` object, including all 11 nested fields) and paste it into the v2 `properties` array at the marker `// === Options collection (see Step 3a below) ===`.

Then, on that pasted outer object only, add one new property so it only renders under Document/Convert:

```ts
displayOptions: { show: { resource: ['document'], operation: ['convert'] } },
```

Do not modify any of the eleven nested fields. Defaults, names, descriptions, and alphabetical order must match v1 verbatim. The pasted entry adds ~200 lines to `DocxToMdV2.node.ts`; that's expected.

### Step 4: Register v2 in `DocxToMd.node.ts`

Modify the file to register v2 (keep `defaultVersion: 1` for this task):

```ts
import type { INodeTypeBaseDescription, IVersionedNodeType } from 'n8n-workflow';
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
			defaultVersion: 1,
			description: 'Converts Docx file to Markdown',
		};

		const nodeVersions: IVersionedNodeType['nodeVersions'] = {
			1: new DocxToMdV1(baseDescription),
			2: new DocxToMdV2(baseDescription),
		};

		super(nodeVersions, baseDescription);
	}
}

export {
	autoTableHeaders,
	convert,
	convertVerbose,
	htmlToMd,
	lint,
	hasZipSignature,
	buildStyleMapString,
} from './shared/convert';
export type {
	ConvertOptions,
	ConvertVerboseResult,
	ExtractedImage,
} from './shared/convert';
```

### Step 5: Run the full suite

Run: `pnpm test:coverage`
Expected: all tests pass, 100% coverage. The new v2 file is exercised by its own test plus the snapshot test (v2 Convert produces v0.3.0-identical Markdown).

### Step 6: Commit

```bash
git add nodes/DocxToMd/v2/ nodes/DocxToMd/DocxToMd.node.ts tests/v2/
git commit -m "$(cat <<'EOF'
Add v2 node with Resource/Operation UI and Convert operation

DocxToMdV2 introduces the Document resource and Convert operation as
a one-to-one port of v1's behaviour, restated under the new UI so
future operations (Extract for RAG) can sit beside it. Registered in
the VersionedNodeType wrapper; defaultVersion stays 1 until Task 9
adds the second operation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `Extract for RAG` operation

The headline operation. Chunks the converted Markdown into LangChain-shaped items.

**Files:**
- Create: `nodes/DocxToMd/v2/extractForRag.ts`
- Modify: `nodes/DocxToMd/v2/DocxToMdV2.node.ts` (UI fields + dispatch)
- Modify: `nodes/DocxToMd/DocxToMd.node.ts` (flip `defaultVersion: 2`)
- Create: `tests/v2/extractForRag.test.ts`

### Step 1: Write the failing tests

Create `tests/v2/extractForRag.test.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { DocxToMdV2 } from '../../nodes/DocxToMd/v2/DocxToMdV2.node';

const FIXTURES = path.join(__dirname, '..', 'fixtures');

interface RagParams {
	resource: string;
	operation: string;
	inputBinaryField: string;
	chunkSize: number;
	chunkOverlap: number;
	splitStrategy: string;
	prependHeadingPath: boolean;
	includeMetadata: boolean;
	sourceField: string;
	options: IDataObject;
}

function makeContext(params: RagParams, buf: Buffer): IExecuteFunctions {
	return {
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name: keyof RagParams) => params[name],
		getNode: () => ({ name: 'Docx to Markdown', type: 'docxToMd', typeVersion: 2 }),
		continueOnFail: () => false,
		helpers: {
			getBinaryDataBuffer: async () => buf,
			prepareBinaryData: async () => ({}),
		},
	} as unknown as IExecuteFunctions;
}

const baseDesc = {
	displayName: 'Docx to Markdown',
	name: 'docxToMd',
	icon: 'file:docxtomd.svg',
	group: ['transform'],
	defaultVersion: 2,
	description: 'Converts Docx file to Markdown',
};

describe('Extract for RAG', () => {
	const headingsBuf = fs.readFileSync(path.join(FIXTURES, 'with-multiple-headings.docx'));

	it('emits one item per chunk with LangChain shape', async () => {
		const node = new DocxToMdV2(baseDesc);
		const ctx = makeContext(
			{
				resource: 'document',
				operation: 'extractForRag',
				inputBinaryField: 'data',
				chunkSize: 2000,
				chunkOverlap: 200,
				splitStrategy: 'markdownHeader',
				prependHeadingPath: true,
				includeMetadata: true,
				sourceField: 'document.docx',
				options: {},
			},
			headingsBuf,
		);
		const result = await node.execute.call(ctx);
		const items = result[0];
		// The headings fixture has 6 sections → should produce ≥ 6 chunks.
		expect(items.length).toBeGreaterThanOrEqual(6);
		for (const it of items) {
			expect(it.json).toHaveProperty('pageContent');
			expect(it.json).toHaveProperty('metadata');
			const meta = (it.json as { metadata: IDataObject }).metadata;
			expect(meta).toMatchObject({
				source: 'document.docx',
				chunkIndex: expect.any(Number),
				totalChunks: expect.any(Number),
			});
		}
	});

	it('prepends the heading path to pageContent when prependHeadingPath = true', async () => {
		const node = new DocxToMdV2(baseDesc);
		const ctx = makeContext(
			{
				resource: 'document',
				operation: 'extractForRag',
				inputBinaryField: 'data',
				chunkSize: 2000,
				chunkOverlap: 0,
				splitStrategy: 'markdownHeader',
				prependHeadingPath: true,
				includeMetadata: true,
				sourceField: 'document.docx',
				options: {},
			},
			headingsBuf,
		);
		const result = await node.execute.call(ctx);
		const items = result[0];
		// Find an item whose heading path is non-trivial.
		const withPath = items.find(
			(it) => (it.json as { metadata: { headingPath?: string } }).metadata.headingPath !== '',
		);
		expect(withPath).toBeDefined();
		const meta = (withPath!.json as { metadata: { headingPath: string } }).metadata;
		expect((withPath!.json as { pageContent: string }).pageContent).toContain(
			meta.headingPath,
		);
	});

	it('omits metadata fields when includeMetadata = false', async () => {
		const node = new DocxToMdV2(baseDesc);
		const ctx = makeContext(
			{
				resource: 'document',
				operation: 'extractForRag',
				inputBinaryField: 'data',
				chunkSize: 2000,
				chunkOverlap: 0,
				splitStrategy: 'markdownHeader',
				prependHeadingPath: false,
				includeMetadata: false,
				sourceField: '',
				options: {},
			},
			headingsBuf,
		);
		const result = await node.execute.call(ctx);
		const meta = (result[0][0].json as { metadata: IDataObject }).metadata;
		expect(Object.keys(meta).sort()).toEqual(['chunkIndex', 'totalChunks']);
	});

	it('uses fixed split when requested', async () => {
		const node = new DocxToMdV2(baseDesc);
		const ctx = makeContext(
			{
				resource: 'document',
				operation: 'extractForRag',
				inputBinaryField: 'data',
				chunkSize: 50,
				chunkOverlap: 5,
				splitStrategy: 'fixed',
				prependHeadingPath: false,
				includeMetadata: false,
				sourceField: '',
				options: {},
			},
			headingsBuf,
		);
		const result = await node.execute.call(ctx);
		expect(result[0].length).toBeGreaterThan(3);
	});
});
```

### Step 2: Run, expect failure

Run: `pnpm test -- --testPathPattern v2/extractForRag`
Expected: test fails because operation `extractForRag` is unknown.

### Step 3: Implement `extractForRag.ts`

Create `nodes/DocxToMd/v2/extractForRag.ts`:

```ts
import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	ConvertOptions,
	convertVerbose,
	hasZipSignature,
	buildStyleMapString,
} from '../shared/convert';
import { extractDocxMetadata, DocxMetadata } from '../shared/metadata';
import { buildHeadingIndex, headingPathAt } from '../shared/headings';
import {
	Chunk,
	ChunkOptions,
	recursiveSplit,
	fixedSplit,
	markdownHeaderSplit,
} from '../shared/chunking';

export type SplitStrategy = 'markdownHeader' | 'recursive' | 'fixed';

export async function runExtractForRag(
	this: IExecuteFunctions,
	i: number,
	returnData: INodeExecutionData[],
): Promise<void> {
	const inputBinaryField = this.getNodeParameter('inputBinaryField', i) as string;
	const chunkSize = this.getNodeParameter('chunkSize', i) as number;
	const chunkOverlap = this.getNodeParameter('chunkOverlap', i) as number;
	const splitStrategy = this.getNodeParameter('splitStrategy', i) as SplitStrategy;
	const prependHeadingPath = this.getNodeParameter('prependHeadingPath', i) as boolean;
	const includeMetadata = this.getNodeParameter('includeMetadata', i) as boolean;
	const sourceField = (this.getNodeParameter('sourceField', i) as string) || '';
	const options = this.getNodeParameter('options', i, {}) as IDataObject;

	const binaryData = await this.helpers.getBinaryDataBuffer(i, inputBinaryField);
	if (!binaryData) {
		throw new NodeOperationError(
			this.getNode(),
			`No binary data found for field "${inputBinaryField}"`,
			{ itemIndex: i },
		);
	}

	if (options.validateDocxSignature !== false && !hasZipSignature(binaryData)) {
		throw new NodeOperationError(
			this.getNode(),
			'Input is not a valid .docx file (expected ZIP signature PK\\x03\\x04)',
			{ itemIndex: i },
		);
	}

	// Conversion options (subset of Convert): we always strip images here.
	const mammothOpts: Record<string, unknown> = {};
	const styleMap = buildStyleMapString(options.customStyleMap);
	if (styleMap !== undefined) mammothOpts.styleMap = styleMap;
	const convertOptions: ConvertOptions = { removeImages: true };
	if (Object.keys(mammothOpts).length > 0) convertOptions.mammoth = mammothOpts;
	if (options.tableFirstRowAsHeader === false) convertOptions.tableFirstRowAsHeader = false;

	const { markdown } = await convertVerbose(binaryData, convertOptions);

	const metadata: DocxMetadata = await extractDocxMetadata(binaryData);
	const headings = buildHeadingIndex(markdown);

	const chunkOpts: ChunkOptions = { chunkSize, chunkOverlap };
	let chunks: Chunk[];
	if (splitStrategy === 'fixed') {
		chunks = fixedSplit(markdown, chunkOpts);
	} else if (splitStrategy === 'recursive') {
		chunks = recursiveSplit(markdown, chunkOpts);
	} else {
		chunks = markdownHeaderSplit(markdown, chunkOpts);
	}

	const lineStarts: number[] = [];
	{
		let acc = 0;
		for (const line of markdown.split('\n')) {
			lineStarts.push(acc);
			acc += line.length + 1;
		}
	}

	function lineForOffset(offset: number): number {
		// Binary search for the largest lineStart <= offset.
		let lo = 0;
		let hi = lineStarts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (lineStarts[mid] <= offset) lo = mid;
			else hi = mid - 1;
		}
		return lo;
	}

	const source = sourceField || metadata.title || 'unknown';
	const totalChunks = chunks.length;

	for (let idx = 0; idx < chunks.length; idx++) {
		const c = chunks[idx];
		const startLine = lineForOffset(c.position.start);
		const endLine = lineForOffset(Math.max(c.position.start, c.position.end - 1));
		const path = headingPathAt(headings, startLine);
		const headingPath = path.join(' > ');

		let pageContent = c.text;
		if (prependHeadingPath && headingPath.length > 0) {
			pageContent = `${headingPath}\n\n${pageContent}`;
		}

		const chunkMeta: IDataObject = {
			chunkIndex: idx,
			totalChunks,
		};

		if (includeMetadata) {
			chunkMeta.source = source;
			chunkMeta.headingPath = headingPath;
			chunkMeta.headings = headingsToFlatDict(path);
			chunkMeta.loc = { lines: { from: startLine, to: endLine } };
			if (metadata.title !== undefined) chunkMeta.title = metadata.title;
			if (metadata.author !== undefined) chunkMeta.author = metadata.author;
			if (metadata.lastModifiedBy !== undefined) chunkMeta.lastModifiedBy = metadata.lastModifiedBy;
			if (metadata.createdAt !== undefined) chunkMeta.createdAt = metadata.createdAt;
			if (metadata.modifiedAt !== undefined) chunkMeta.modifiedAt = metadata.modifiedAt;
			if (metadata.revision !== undefined) chunkMeta.revision = metadata.revision;
			if (metadata.wordCount !== undefined) chunkMeta.wordCount = metadata.wordCount;
			if (metadata.charCount !== undefined) chunkMeta.charCount = metadata.charCount;
			if (metadata.pageCount !== undefined) chunkMeta.pageCount = metadata.pageCount;
		}

		returnData.push({
			json: { pageContent, metadata: chunkMeta },
			pairedItem: { item: i },
		});
	}
}

function headingsToFlatDict(path: string[]): IDataObject {
	const out: IDataObject = {};
	for (let i = 0; i < path.length && i < 6; i++) {
		out[`h${i + 1}`] = path[i];
	}
	return out;
}
```

### Step 4: Wire into `DocxToMdV2.node.ts`

Add the operation to the `Operation` options array:

```ts
{
	name: 'Extract for RAG',
	value: 'extractForRag',
	description:
		'Convert to Markdown and split into LangChain Document-shaped chunks for vector store ingest',
	action: 'Extract docx as RAG-ready chunks',
},
```

Add the operation-specific fields (all gated on `displayOptions.show.operation = ['extractForRag']`):

```ts
{
	displayName: 'Input Binary Field',
	name: 'inputBinaryField',
	type: 'string',
	default: 'data',
	required: true,
	description: 'The name of the input binary field containing the Docx file',
	displayOptions: { show: { resource: ['document'], operation: ['extractForRag'] } },
},
{
	displayName: 'Chunk Size',
	name: 'chunkSize',
	type: 'number',
	default: 2000,
	description: 'Maximum chunk size in characters (≈500 tokens at 4:1 approximation)',
	displayOptions: { show: { resource: ['document'], operation: ['extractForRag'] } },
},
{
	displayName: 'Chunk Overlap',
	name: 'chunkOverlap',
	type: 'number',
	default: 200,
	description: 'Characters shared between adjacent chunks',
	displayOptions: { show: { resource: ['document'], operation: ['extractForRag'] } },
},
{
	displayName: 'Split Strategy',
	name: 'splitStrategy',
	type: 'options',
	default: 'markdownHeader',
	options: [
		{ name: 'Markdown Header', value: 'markdownHeader' },
		{ name: 'Recursive', value: 'recursive' },
		{ name: 'Fixed (sliding window)', value: 'fixed' },
	],
	description:
		'How to split the Markdown into chunks. Markdown Header is the default — splits on H1/H2/H3 and falls back to recursive within oversized sections',
	displayOptions: { show: { resource: ['document'], operation: ['extractForRag'] } },
},
{
	displayName: 'Prepend Heading Path',
	name: 'prependHeadingPath',
	type: 'boolean',
	default: true,
	description:
		'Whether to prefix each chunk text with its heading path (boosts retrieval — see "contextual retrieval" pattern)',
	displayOptions: { show: { resource: ['document'], operation: ['extractForRag'] } },
},
{
	displayName: 'Include Metadata',
	name: 'includeMetadata',
	type: 'boolean',
	default: true,
	description:
		'Whether to attach docx metadata (title, author, dates, headingPath, etc.) to each chunk',
	displayOptions: { show: { resource: ['document'], operation: ['extractForRag'] } },
},
{
	displayName: 'Source Field',
	name: 'sourceField',
	type: 'string',
	default: '',
	placeholder: 'e.g. {{ $binary.data.fileName }} or a literal filename',
	description:
		'Value placed in metadata.source. Defaults to the document title or "unknown"',
	displayOptions: { show: { resource: ['document'], operation: ['extractForRag'] } },
},
```

The existing Options collection's `displayOptions` should expand to include both operations:

```ts
displayOptions: {
	show: { resource: ['document'], operation: ['convert', 'extractForRag'] },
},
```

(Image-related options inside the collection — Extract Images, Image Link Format — should NOT show for extractForRag; gate them additionally:

```ts
displayOptions: { show: { '/operation': ['convert'] } },
```

inside their entries. Use the leading-slash form because they're nested inside the collection.)

In the `execute` method, add the dispatch:

```ts
import { runExtractForRag } from './extractForRag';

// inside the try:
if (operation === 'convert') {
	await runConvert.call(this, i, returnData);
} else if (operation === 'extractForRag') {
	await runExtractForRag.call(this, i, returnData);
} else {
	throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, {
		itemIndex: i,
	});
}
```

### Step 5: Flip `defaultVersion` to 2 in `DocxToMd.node.ts`

Edit `nodes/DocxToMd/DocxToMd.node.ts` and change `defaultVersion: 1` to `defaultVersion: 2`.

### Step 6: Run the full suite + coverage

Run: `pnpm test:coverage`
Expected: all green, 100/100/100/100. If a chunking-strategy branch or a metadata branch is uncovered in `extractForRag.ts`, add a targeted test that exercises it.

### Step 7: Commit

```bash
git add nodes/DocxToMd/v2/ nodes/DocxToMd/DocxToMd.node.ts tests/v2/extractForRag.test.ts
git commit -m "$(cat <<'EOF'
Add Extract for RAG operation and make v2 the default

The new operation chains shared/{metadata,headings,chunking} to emit
LangChain Document-shaped items — one per chunk — with optional
heading-path prepending and per-chunk metadata (source, chunkIndex,
totalChunks, headingPath, headings, loc.lines, plus docx core
properties when present). Flips defaultVersion from 1 to 2 so new
workflows pick up the Resource/Operation UI by default; existing v1
workflows are unaffected.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Promote `jszip` to `dependencies`

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

### Step 1: Move the entry

Edit `package.json`. Remove `jszip` from `devDependencies` and add it to `dependencies` (keep the same version range `^3.10.1`):

```json
"dependencies": {
	"@joplin/turndown": "^4.0.80",
	"@joplin/turndown-plugin-gfm": "^1.0.62",
	"jszip": "^3.10.1",
	"mammoth": "^1.9.1",
	"markdownlint": "^0.38.0",
	"node-html-parser": "^7.0.1"
},
"devDependencies": {
	// jszip removed from here
	"@babel/preset-env": "^7.29.5",
	// ...
}
```

### Step 2: Refresh the lockfile

Run: `pnpm install --lockfile-only`
Expected: lockfile updates with `jszip` recorded as a runtime dep.

### Step 3: Build + test

Run: `pnpm lint && pnpm build && pnpm test:coverage`
Expected: all green, 100%.

### Step 4: Commit

```bash
git add package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
Promote jszip from devDependencies to dependencies

jszip is now used at run time by shared/metadata.ts (and reused by the
fixture generator). Bundle footprint ≈95 KB minified — acceptable
alongside mammoth/turndown/markdownlint.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: CHANGELOG entry for 0.4.0

**Files:**
- Modify: `CHANGELOG.md`

### Step 1: Insert the new entry at the top

Add a `## [0.4.0] - 2026-MM-DD` block immediately under the title (above the existing 0.3.0/0.3.0-beta.0 entry):

```markdown
## [0.4.0] - 2026-MM-DD

### Added
- `VersionedNodeType` wrapper. v1 (frozen) preserves v0.3.0 behaviour
  exactly for existing workflows; v2 (new default) introduces
  Resource/Operation UI.
- v2 operation **Extract for RAG** — converts a docx to Markdown and
  emits LangChain `Document`-shaped items (one per chunk):
  - `pageContent` + `metadata` shape so n8n vector store nodes consume
    output directly.
  - Three split strategies: `markdownHeader` (default), `recursive`,
    `fixed`.
  - Optional `prependHeadingPath` for the contextual retrieval pattern.
  - Per-chunk metadata: `source`, `title`, `author`, `createdAt`,
    `modifiedAt`, `lastModifiedBy`, `revision`, `wordCount`, `charCount`,
    `pageCount`, `chunkIndex`, `totalChunks`, `headingPath`, `headings`
    (flat h1/h2/h3 dict), `loc.lines.from/to`.
- Docx metadata extractor reads `docProps/core.xml` and
  `docProps/app.xml` via JSZip; tolerant to missing/malformed entries.

### Changed
- `jszip` moves from `devDependencies` to `dependencies` (runtime use).
- v2 is the default version for new workflows; v1 stays available for
  existing ones.

### Internal
- Conversion helpers moved to `nodes/DocxToMd/shared/convert.ts`.
- New shared modules: `shared/metadata.ts`, `shared/headings.ts`,
  `shared/chunking.ts`.
- `tests/v1Snapshot.test.ts` locks v0.3.0 output against committed
  golden strings to catch silent regressions in shared helpers.
```

Update the link-references block at the bottom:

```markdown
[0.4.0]: https://github.com/sfrangulov/n8n-nodes-docx-to-md/releases/tag/v0.4.0
```

(Keep all earlier link-references in place.)

Replace `2026-MM-DD` with the actual release date when Task 13 commits the bump.

### Step 2: Commit

```bash
git add CHANGELOG.md
git commit -m "$(cat <<'EOF'
Add 0.4.0 CHANGELOG entry

Documents the VersionedNodeType split, the Extract for RAG operation,
the new shared modules, and the jszip promotion.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: README — "RAG / Vector Store integration" section

**Files:**
- Modify: `README.md`

### Step 1: Insert the section after "Options Collection" / "Output Shape" / "Error Handling"

Add immediately after the "Error Handling" subsection (before "Example Workflow"):

```markdown
### RAG / Vector Store Integration (v2)

Starting with version `0.4.0` the node ships a second internal version
(`v2`) with a Resource/Operation UI. v1 stays available for existing
workflows; v2 is the default for new ones.

Under **Resource: Document**, choose the **Extract for RAG** operation
to convert a `.docx` and split the resulting Markdown into chunks
shaped like LangChain `Document` objects — `{ pageContent, metadata }`.
Each chunk becomes a separate n8n item, ready to feed straight into
any n8n vector store node.

| Field | Default | What it does |
|---|---|---|
| Chunk Size | `2000` chars (≈500 tokens) | Maximum chunk length |
| Chunk Overlap | `200` chars (≈10%) | Characters shared between adjacent chunks |
| Split Strategy | `Markdown Header` | `Markdown Header` (split on `#`/`##`/`###`, then size-cap recursively) / `Recursive` / `Fixed` (sliding window) |
| Prepend Heading Path | `true` | Prefix each chunk with `H1 > H2 > H3\n\n` for "contextual retrieval" |
| Include Metadata | `true` | Attach docx metadata + heading info to each chunk |
| Source Field | empty | Sets `metadata.source`; falls back to the docx title or `"unknown"` |

#### Example chunk

```json
{
  "pageContent": "Introduction > Background\n\nThe Q3 strategy is …",
  "metadata": {
    "source": "Q3-Strategy.docx",
    "title": "Q3 Strategy Doc",
    "author": "Alice",
    "createdAt": "2026-03-15T10:00:00Z",
    "chunkIndex": 0,
    "totalChunks": 17,
    "headingPath": "Introduction > Background",
    "headings": { "h1": "Introduction", "h2": "Background" },
    "loc": { "lines": { "from": 12, "to": 43 } },
    "wordCount": 4831,
    "pageCount": 18
  }
}
```

#### Suggested workflow

`Read Binary File` → `Docx to Markdown (Extract for RAG)` → `Embeddings node` → `Vector Store (Insert)`

The `pageContent` field is the LangChain Document convention that every
n8n vector store node consumes; no intermediate `Default Data Loader` is
required.
```

### Step 2: Commit

```bash
git add README.md
git commit -m "$(cat <<'EOF'
Document the v2 Resource/Operation UI and Extract for RAG in README

Adds a RAG / Vector Store Integration section: param table, example
chunk JSON, and a one-line suggested workflow. Notes v1 stays
available for existing workflows.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Version bump to `0.4.0-beta.0`

Following the v0.3.0 pattern: ship as a beta first.

**Files:**
- Modify: `package.json`
- Modify: `CHANGELOG.md` (update the date and version)

### Step 1: Bump

In `package.json`: change `"version": "0.3.0-beta.0"` (or the current value) to `"version": "0.4.0-beta.0"`.

In `CHANGELOG.md`: change the `## [0.4.0] - 2026-MM-DD` header to `## [0.4.0-beta.0] - <today>` and update the link-reference to the beta tag.

### Step 2: Pre-publish check

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm build
pnpm test:coverage
```

All four green; coverage 100%.

### Step 3: Commit + tag

```bash
git add package.json CHANGELOG.md
git commit -m "$(cat <<'EOF'
Bump version to 0.4.0-beta.0

Release notes in CHANGELOG.md. Publish with --tag beta to keep latest
on 0.3.0.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"

git tag -a v0.4.0-beta.0 -m "Pre-release 0.4.0-beta.0"
```

Do NOT push the tag or branch — leave that to the user.

### Step 4: Final summary

Run:

```bash
git log --oneline <pre-task-1-sha>..HEAD
git diff <pre-task-1-sha>..HEAD --stat
```

Report:
- Number of commits on the branch
- Diff stat summary
- Final coverage line
- Local tag name
- Reminder that pushing branch + tag and `npm publish --tag beta` are user-driven.

---

## Post-implementation: verify and report

Before declaring the plan complete, from a clean working tree:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm build
pnpm test:coverage
```

All four must pass. Coverage must be 100% on `nodes/**` and `credentials/**`.

Also sanity-check:

- `pnpm pack` produces a tarball; inspect it with `tar -tzf` to confirm `dist/nodes/DocxToMd/{v1,v2,shared}` are all included.
- `dist/nodes/DocxToMd/DocxToMd.node.js` is still the registered file (per `package.json` `n8n.nodes`).
