import * as fs from 'fs';
import * as path from 'path';
import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { DocxToMd } from '../nodes/DocxToMd/DocxToMd.node';

const FIXTURES = path.join(__dirname, 'fixtures');

interface Params {
	inputBinaryField: string;
	destinationOutputField: string;
	removeImages: boolean;
	options: IDataObject;
}

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
			prepareBinaryData: async (data: Buffer, fileName: string, mimeType: string) => ({
				data: data.toString('base64'),
				mimeType,
				fileName,
			}),
		},
	};
	return ctx as unknown as IExecuteFunctions;
}

describe('DocxToMd.execute', () => {
	const simpleBuf = fs.readFileSync(path.join(FIXTURES, 'simple.docx'));
	const customStyleBuf = fs.readFileSync(path.join(FIXTURES, 'with-custom-style.docx'));

	it('converts one item and writes the result into the configured output field', async () => {
		const ctx = makeContext({
			itemCount: 1,
			params: { inputBinaryField: 'data', destinationOutputField: 'text', removeImages: false, options: {} },
			binaryBuffer: simpleBuf,
		});
		const node = new DocxToMd();
		const result = await node.execute.call(ctx);
		expect(result).toHaveLength(1);
		const out = result[0][0].json as { text: string };
		expect(out.text).toContain('# Hello World');
	});

	it('honours the destinationOutputField parameter', async () => {
		const ctx = makeContext({
			itemCount: 1,
			params: { inputBinaryField: 'data', destinationOutputField: 'markdown', removeImages: false, options: {} },
			binaryBuffer: simpleBuf,
		});
		const node = new DocxToMd();
		const result = await node.execute.call(ctx);
		const out = result[0][0].json as Record<string, unknown>;
		expect(out).toHaveProperty('markdown');
		expect(out).not.toHaveProperty('text');
	});

	it('processes every input item', async () => {
		const ctx = makeContext({
			itemCount: 3,
			params: { inputBinaryField: 'data', destinationOutputField: 'text', removeImages: false, options: {} },
			binaryBuffer: simpleBuf,
		});
		const node = new DocxToMd();
		const result = await node.execute.call(ctx);
		expect(result[0]).toHaveLength(3);
	});

	it('returns an empty result for an empty input items array', async () => {
		const ctx = makeContext({
			itemCount: 0,
			params: { inputBinaryField: 'data', destinationOutputField: 'text', removeImages: false, options: {} },
			binaryBuffer: simpleBuf,
		});
		const node = new DocxToMd();
		const result = await node.execute.call(ctx);
		expect(result[0]).toEqual([]);
	});

	it('throws NodeOperationError when no binary data is found', async () => {
		const ctx = makeContext({
			itemCount: 1,
			params: { inputBinaryField: 'data', destinationOutputField: 'text', removeImages: false, options: {} },
			binaryBuffer: null,
		});
		const node = new DocxToMd();
		await expect(node.execute.call(ctx)).rejects.toThrow(
			/No binary data found for field "data"/,
		);
	});

	it('passes removeImages=true through to convert', async () => {
		const imageBuf = fs.readFileSync(path.join(FIXTURES, 'with-image.docx'));
		const ctx = makeContext({
			itemCount: 1,
			params: { inputBinaryField: 'data', destinationOutputField: 'text', removeImages: true, options: {} },
			binaryBuffer: imageBuf,
		});
		const node = new DocxToMd();
		const result = await node.execute.call(ctx);
		const out = result[0][0].json as { text: string };
		expect(out.text).not.toMatch(/!\[/);
		expect(out.text).toContain('Before image.');
	});

	it('continues on fail and emits an error item when continueOnFail is true', async () => {
		const ctx = makeContext({
			itemCount: 1,
			params: { inputBinaryField: 'data', destinationOutputField: 'text', removeImages: false, options: {} },
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

	it('wraps a non-NodeOperationError as NodeOperationError when continueOnFail is true', async () => {
		// Pass invalid bytes so mammoth throws a generic Error (not NodeOperationError)
		const invalidBuf = Buffer.from('not a docx file');
		const ctx = makeContext({
			itemCount: 1,
			params: { inputBinaryField: 'data', destinationOutputField: 'text', removeImages: false, options: {} },
			binaryBuffer: invalidBuf,
			continueOnFail: true,
		});
		const node = new DocxToMd();
		const result = await node.execute.call(ctx);
		expect(result[0]).toHaveLength(1);
		const out = result[0][0];
		expect(out.json).toHaveProperty('error');
		expect(out.error).toBeInstanceOf(NodeOperationError);
		expect(out.pairedItem).toEqual({ item: 0 });
	});

	it('wraps a non-NodeOperationError as NodeOperationError when continueOnFail is false', async () => {
		// Pass invalid bytes so mammoth throws a generic Error (not NodeOperationError)
		const invalidBuf = Buffer.from('not a docx file');
		const ctx = makeContext({
			itemCount: 1,
			params: { inputBinaryField: 'data', destinationOutputField: 'text', removeImages: false, options: {} },
			binaryBuffer: invalidBuf,
			continueOnFail: false,
		});
		const node = new DocxToMd();
		await expect(node.execute.call(ctx)).rejects.toBeInstanceOf(NodeOperationError);
	});

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
		expect(out.text).toMatch(/^Hello World\n=+/m);
	});

	it('threads Options.bulletListMarker through to the converter', async () => {
		const ctx = makeContext({
			itemCount: 1,
			params: {
				inputBinaryField: 'data',
				destinationOutputField: 'text',
				removeImages: false,
				options: { bulletListMarker: '*' },
			},
			binaryBuffer: simpleBuf,
		});
		const node = new DocxToMd();
		const result = await node.execute.call(ctx);
		const out = result[0][0].json as { text: string };
		expect(out.text).toMatch(/^\* First item/m);
	});

	it('threads Options.codeBlockStyle through to the converter', async () => {
		const ctx = makeContext({
			itemCount: 1,
			params: {
				inputBinaryField: 'data',
				destinationOutputField: 'text',
				removeImages: false,
				options: { codeBlockStyle: 'indented' },
			},
			binaryBuffer: simpleBuf,
		});
		const node = new DocxToMd();
		const result = await node.execute.call(ctx);
		const out = result[0][0].json as { text: string };
		expect(out.text).toMatch(/^ {4}const x = 1;/m);
	});

	// Behavioural correctness is covered by the convert-level test;
	// this test exists to ensure the execute path wires options.tableFirstRowAsHeader
	// through to convertOptions.tableFirstRowAsHeader.
	it('skips autoTableHeaders when Options.tableFirstRowAsHeader = false', async () => {
		const tableBuf = fs.readFileSync(path.join(FIXTURES, 'with-table.docx'));
		const ctx = makeContext({
			itemCount: 1,
			params: {
				inputBinaryField: 'data',
				destinationOutputField: 'text',
				removeImages: false,
				options: { tableFirstRowAsHeader: false },
			},
			binaryBuffer: tableBuf,
		});
		const node = new DocxToMd();
		const result = await node.execute.call(ctx);
		const out = result[0][0].json as { text: string };
		expect(out.text).not.toMatch(/\|\s*Header A\s*\|\s*Header B\s*\|\s*\n\s*\|\s*-+\s*\|/);
	});

	// Behavioural correctness is covered by the convert-level test above;
	// this test exists to ensure the execute path wires options.lintMarkdown
	// through to convertOptions.lint.
	it('skips markdownlint when Options.lintMarkdown = false', async () => {
		const ctx = makeContext({
			itemCount: 1,
			params: {
				inputBinaryField: 'data',
				destinationOutputField: 'text',
				removeImages: false,
				options: { lintMarkdown: false },
			},
			binaryBuffer: simpleBuf,
		});
		const node = new DocxToMd();
		const result = await node.execute.call(ctx);
		const out = result[0][0].json as { text: string };
		expect(out.text).toContain('# Hello World');
	});

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
		// Whatever mammoth throws, it must NOT be our signature error.
		await expect(node.execute.call(ctx)).rejects.not.toThrow(
			/Input is not a valid \.docx file/,
		);
	});

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

	it('applies a Custom Style Map from the Options collection', async () => {
		const ctx = makeContext({
			itemCount: 1,
			params: {
				inputBinaryField: 'data',
				destinationOutputField: 'text',
				removeImages: false,
				options: {
					customStyleMap: {
						mapping: [{ from: "p[style-name='MyCallout']", to: 'blockquote:fresh' }],
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

	it('extractImages wins over removeImages at the execute level', async () => {
		const imageBuf = fs.readFileSync(path.join(FIXTURES, 'with-image.docx'));
		const ctx = makeContext({
			itemCount: 1,
			params: {
				inputBinaryField: 'data',
				destinationOutputField: 'text',
				removeImages: true,
				options: { extractImages: true },
			},
			binaryBuffer: imageBuf,
		});
		const node = new DocxToMd();
		const result = await node.execute.call(ctx);
		const item = result[0][0];
		expect(item.binary).toHaveProperty('image_1');
		expect((item.json as { text: string }).text).toMatch(/!\[\]\(image_1\)/);
	});
});

describe('DocxToMd.description', () => {
	const node = new DocxToMd();

	it('declares the expected metadata', () => {
		expect(node.description.name).toBe('docxToMd');
		expect(node.description.displayName).toBe('Docx to Markdown');
		expect(node.description.group).toEqual(['transform']);
		expect(node.description.version).toBe(1);
		expect(node.description.usableAsTool).toBe(true);
	});

	it('has the three configurable properties with the right defaults', () => {
		const props = node.description.properties;
		const byName = Object.fromEntries(props.map((p) => [p.name, p]));
		expect(byName.inputBinaryField.default).toBe('data');
		expect(byName.inputBinaryField.required).toBe(true);
		expect(byName.destinationOutputField.default).toBe('text');
		expect(byName.destinationOutputField.required).toBe(true);
		expect(byName.removeImages.default).toBe(false);
		expect(byName.removeImages.type).toBe('boolean');
	});

	it('declares exactly one main input and one main output', () => {
		expect(node.description.inputs).toHaveLength(1);
		expect(node.description.outputs).toHaveLength(1);
	});
});
