import * as fs from 'fs';
import * as path from 'path';
import { convert, convertVerbose, extensionFor } from '../nodes/DocxToMd/DocxToMd.node';

const FIXTURES = path.join(__dirname, 'fixtures');
const SIMPLE = path.join(FIXTURES, 'simple.docx');
const WITH_TABLE = path.join(FIXTURES, 'with-table.docx');
const WITH_IMAGE = path.join(FIXTURES, 'with-image.docx');
const WITH_CUSTOM_STYLE = path.join(FIXTURES, 'with-custom-style.docx');

describe('convert', () => {
	it('converts a docx file given by path to markdown', async () => {
		const md = await convert(SIMPLE);
		expect(md).toContain('# Hello World');
		expect(md).toMatch(/\*\*bold\*\*/);
		expect(md).toContain('First item');
	});

	it('converts a docx given as a Buffer', async () => {
		const buf = fs.readFileSync(SIMPLE);
		const md = await convert(buf);
		expect(md).toContain('# Hello World');
	});

	it('converts a docx given as an ArrayBuffer', async () => {
		const buf = fs.readFileSync(SIMPLE);
		const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
		const md = await convert(ab as ArrayBuffer);
		expect(md).toContain('# Hello World');
	});

	it('runs autoTableHeaders so that tables render with a header row', async () => {
		const md = await convert(WITH_TABLE);
		// gfm pipe-table syntax: first row = headers, second row = | --- | --- |
		expect(md).toMatch(/\|\s*Header A\s*\|\s*Header B\s*\|/);
		expect(md).toMatch(/\|\s*-+\s*\|\s*-+\s*\|/);
		expect(md).toContain('Row 1 A');
	});

	it('keeps image references by default', async () => {
		const md = await convert(WITH_IMAGE);
		expect(md).toMatch(/!\[.*\]\(data:image\/png/);
		expect(md).toContain('Before image.');
		expect(md).toContain('After image.');
	});

	it('strips image references when removeImages is true', async () => {
		const md = await convert(WITH_IMAGE, { removeImages: true });
		expect(md).not.toMatch(/!\[/);
		expect(md).not.toMatch(/data:image\/png/);
		expect(md).toContain('Before image.');
		expect(md).toContain('After image.');
	});

	it('passes mammoth options through', async () => {
		// Pass a known-valid mammoth option just to exercise that branch.
		const md = await convert(SIMPLE, { mammoth: { includeDefaultStyleMap: true } });
		expect(md).toContain('# Hello World');
	});

	it('passes turndown options through', async () => {
		const md = await convert(SIMPLE, { turndown: { emDelimiter: '_' } });
		expect(md).toContain('# Hello World');
	});

	it('renders setext-style headings when turndown.headingStyle = setext', async () => {
		const md = await convert(SIMPLE, { turndown: { headingStyle: 'setext' } });
		expect(md).toMatch(/^Hello World\n=+/m);
	});

	it('uses asterisks for bullets when turndown.bulletListMarker = *', async () => {
		const md = await convert(SIMPLE, { turndown: { bulletListMarker: '*' } });
		expect(md).toMatch(/^\* First item/m);
	});

	it('emits indented code blocks when turndown.codeBlockStyle = indented', async () => {
		const md = await convert(SIMPLE, { turndown: { codeBlockStyle: 'indented' } });
		expect(md).toMatch(/^ {4}const x = 1;/m);
	});

	it('emits fenced code blocks by default', async () => {
		const md = await convert(SIMPLE);
		expect(md).toContain('```\nconst x = 1;\n```');
	});

	it('skips the markdownlint pass when lint = false', async () => {
		const lintedDefault = await convert(SIMPLE);
		const unlinted = await convert(SIMPLE, { lint: false });
		expect(unlinted).toContain('# Hello World');
		// SIMPLE deliberately contains consecutive blank paragraphs; markdownlint
		// MD012 collapses them. So the unlinted output must be strictly longer
		// and must differ from the linted output.
		expect(unlinted).not.toBe(lintedDefault);
		expect(unlinted.length).toBeGreaterThan(lintedDefault.length);
	});

	it('keeps the original first row as data when tableFirstRowAsHeader = false', async () => {
		const md = await convert(WITH_TABLE, { tableFirstRowAsHeader: false });
		// Without the header rewrite, turndown emits its own empty-header row;
		// the original "Header A"/"Header B" cells should NOT appear in the
		// header row (the line above the |---|---| separator).
		expect(md).toContain('Header A');
		expect(md).toContain('Row 1 A');
		expect(md).not.toMatch(/\|\s*Header A\s*\|\s*Header B\s*\|\s*\n\s*\|\s*-+\s*\|/);
	});

	it('exposes mammoth warnings via convertVerbose', async () => {
		// Reading via path makes mammoth verify the document fully — warnings appear
		// for any unrecognised style. Our fixtures don't trigger warnings, so use
		// a custom style map that references an unknown style to force one.
		const buf = fs.readFileSync(SIMPLE);
		const { markdown, warnings } = await convertVerbose(buf, {
			mammoth: { styleMap: "p[style-name='Nonexistent Style'] => h2:fresh" },
		});
		expect(markdown).toContain('# Hello World');
		expect(Array.isArray(warnings)).toBe(true);
	});

	it('convertVerbose works without options argument (uses defaults)', async () => {
		const buf = fs.readFileSync(SIMPLE);
		const { markdown, warnings } = await convertVerbose(buf);
		expect(markdown).toContain('# Hello World');
		expect(Array.isArray(warnings)).toBe(true);
	});

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

	it('applies a custom style map passed through mammoth options', async () => {
		const md = await convert(WITH_CUSTOM_STYLE, {
			mammoth: { styleMap: "p[style-name='MyCallout'] => blockquote:fresh" },
		});
		expect(md).toMatch(/^>\s+This paragraph uses a custom style\./m);
		expect(md).toContain('Regular paragraph.');
	});

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

	it('extractImages wins over removeImages when both are true', async () => {
		const buf = fs.readFileSync(WITH_IMAGE);
		const { markdown, images } = await convertVerbose(buf, {
			extractImages: true,
			removeImages: true,
		});
		expect(images).toBeDefined();
		expect(images!.length).toBe(1);
		// extractImages wins: image ref should be present, not stripped
		expect(markdown).toMatch(/!\[\]\(image_1\)/);
	});

	describe('extensionFor', () => {
		it('returns jpg for image/jpeg', () => expect(extensionFor('image/jpeg')).toBe('jpg'));
		it('returns jpg for image/jpg', () => expect(extensionFor('image/jpg')).toBe('jpg'));
		it('returns png for image/png', () => expect(extensionFor('image/png')).toBe('png'));
		it('returns gif for image/gif', () => expect(extensionFor('image/gif')).toBe('gif'));
		it('returns webp for image/webp', () => expect(extensionFor('image/webp')).toBe('webp'));
		it('returns svg for image/svg+xml', () => expect(extensionFor('image/svg+xml')).toBe('svg'));
		it('returns bmp for image/bmp', () => expect(extensionFor('image/bmp')).toBe('bmp'));
		it('returns tiff for image/tiff', () => expect(extensionFor('image/tiff')).toBe('tiff'));
		it('returns bin for unknown mime type', () => expect(extensionFor('application/octet-stream')).toBe('bin'));
		it('is case-insensitive', () => expect(extensionFor('IMAGE/PNG')).toBe('png'));
	});
});
