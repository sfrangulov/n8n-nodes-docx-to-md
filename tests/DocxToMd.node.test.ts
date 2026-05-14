import * as fs from 'fs';
import * as path from 'path';
import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { DocxToMd } from '../nodes/DocxToMd/DocxToMd.node';

const FIXTURES = path.join(__dirname, 'fixtures');

interface Params {
	inputBinaryField: string;
	destinationOutputField: string;
	removeImages: boolean;
}

function makeContext(opts: {
	itemCount: number;
	params: Params;
	binaryBuffer: Buffer | null;
}): IExecuteFunctions {
	const items = Array.from({ length: opts.itemCount }, (_, i) => ({ json: { idx: i } }));
	const ctx = {
		getInputData: () => items,
		getNodeParameter: (name: keyof Params) => opts.params[name],
		getNode: () => ({ name: 'Docx to Markdown', type: 'docxToMd', typeVersion: 1 }),
		helpers: {
			getBinaryDataBuffer: async () => opts.binaryBuffer,
			// Mirrors n8n's behavior: items already wrapped with { json } are passed through.
			returnJsonArray: (data: Array<Record<string, unknown>>): INodeExecutionData[] =>
				data.map((item) =>
					'json' in item ? (item as INodeExecutionData) : { json: item as INodeExecutionData['json'] },
				),
		},
	};
	return ctx as unknown as IExecuteFunctions;
}

describe('DocxToMd.execute', () => {
	const simpleBuf = fs.readFileSync(path.join(FIXTURES, 'simple.docx'));

	it('converts one item and writes the result into the configured output field', async () => {
		const ctx = makeContext({
			itemCount: 1,
			params: { inputBinaryField: 'data', destinationOutputField: 'text', removeImages: false },
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
			params: { inputBinaryField: 'data', destinationOutputField: 'markdown', removeImages: false },
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
			params: { inputBinaryField: 'data', destinationOutputField: 'text', removeImages: false },
			binaryBuffer: simpleBuf,
		});
		const node = new DocxToMd();
		const result = await node.execute.call(ctx);
		expect(result[0]).toHaveLength(3);
	});

	it('returns an empty result for an empty input items array', async () => {
		const ctx = makeContext({
			itemCount: 0,
			params: { inputBinaryField: 'data', destinationOutputField: 'text', removeImages: false },
			binaryBuffer: simpleBuf,
		});
		const node = new DocxToMd();
		const result = await node.execute.call(ctx);
		expect(result[0]).toEqual([]);
	});

	it('throws NodeOperationError when no binary data is found', async () => {
		const ctx = makeContext({
			itemCount: 1,
			params: { inputBinaryField: 'data', destinationOutputField: 'text', removeImages: false },
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
			params: { inputBinaryField: 'data', destinationOutputField: 'text', removeImages: true },
			binaryBuffer: imageBuf,
		});
		const node = new DocxToMd();
		const result = await node.execute.call(ctx);
		const out = result[0][0].json as { text: string };
		expect(out.text).not.toMatch(/!\[/);
		expect(out.text).toContain('Before image.');
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
