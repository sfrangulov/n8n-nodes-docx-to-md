import * as fs from 'fs';
import * as path from 'path';
import { convert } from '../nodes/DocxToMd/DocxToMd.node';

const FIXTURES = path.join(__dirname, 'fixtures');
const SIMPLE = path.join(FIXTURES, 'simple.docx');
const WITH_TABLE = path.join(FIXTURES, 'with-table.docx');
const WITH_IMAGE = path.join(FIXTURES, 'with-image.docx');

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
});
