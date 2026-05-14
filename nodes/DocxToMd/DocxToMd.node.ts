import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionType, NodeOperationError } from 'n8n-workflow';

// @ts-ignore
import TurndownService from '@joplin/turndown';
// @ts-ignore
import * as turndownPluginGfm from '@joplin/turndown-plugin-gfm';
import * as mammoth from 'mammoth';
// @ts-ignore
const markdownlintSync = require('markdownlint/sync');
// @ts-ignore
const markdownlint = require('markdownlint');
import { parse } from 'node-html-parser';

export interface ConvertOptions {
	mammoth?: object;
	turndown?: object;
	removeImages?: boolean;
	lint?: boolean;
	tableFirstRowAsHeader?: boolean;
}

interface TurndownOptions {
	headingStyle?: 'setext' | 'atx';
	codeBlockStyle?: 'indented' | 'fenced';
	bulletListMarker?: '*' | '-' | '+';
}

const defaultTurndownOptions: TurndownOptions = {
	headingStyle: 'atx',
	codeBlockStyle: 'fenced',
	bulletListMarker: '-',
};

function hasZipSignature(buf: Buffer): boolean {
	return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04;
}

// Turndown will add an empty header if the first row
// of the table isn't `<th>` elements. This function
// converts the first row of a table to `<th>` elements
// so that it renders correctly in Markdown.
export function autoTableHeaders(html: string): string {
	const root = parse(html);
	root.querySelectorAll('table').forEach((table: any) => {
		const firstRow = table.querySelector('tr');
		firstRow.querySelectorAll('td').forEach((cell: any) => {
			cell.tagName = 'th';
		});
	});
	return root.toString();
}

// Convert HTML to GitHub-flavored Markdown
export function htmlToMd(html: string, options: object = {}, removeImages: boolean = false): string {
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

	// Add rule to remove images if option is enabled
	if (removeImages) {
		turndownService.addRule('removeImages', {
			filter: 'img',
			replacement: function () {
				return '';
			},
		});
	}

	return turndownService.turndown(html).trim();
}

// Lint the Markdown and correct any issues
export async function lint(md: string): Promise<string> {
	const options = {
		strings: {
			content: md,
		},
	};
	const lintResult = markdownlintSync.lint(options);
	return markdownlint.applyFixes(md, lintResult['content']).trim();
}

// Converts a Word document to crisp, clean Markdown
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
	const html = options.tableFirstRowAsHeader === false
		? mammothResult.value
		: autoTableHeaders(mammothResult.value);
	const md = htmlToMd(html, options.turndown, options.removeImages);
	if (options.lint === false) return md.trim();
	return lint(md);
}

export class DocxToMd implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Docx to Markdown',
		name: 'docxToMd',
		icon: 'file:docxtomd.svg',
		group: ['transform'],
		version: 1,
		description: 'Converts Docx file to Markdown',
		defaults: {
			name: 'Docx to Markdown',
		},
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
		usableAsTool: true,
		properties: [
			{
				displayName: 'Input Binary Field',
				name: 'inputBinaryField',
				type: 'string',
				default: 'data',
				placeholder: 'Input binary field containing the Docx file',
				description: 'The name of the input binary field containing the Docx file',
				required: true,
			},
			{
				displayName: 'Destination Output Field',
				name: 'destinationOutputField',
				type: 'string',
				default: 'text',
				placeholder: 'Destination output field for the converted Markdown text',
				description: 'The name of the destination output field for the converted Markdown text',
				required: true,
			},
			{
				displayName: 'Remove Images',
				name: 'removeImages',
				type: 'boolean',
				default: false,
				description: 'Whether to remove images from the converted Markdown',
			},
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
					{
						displayName: 'Lint Markdown',
						name: 'lintMarkdown',
						type: 'boolean',
						default: true,
						description: 'Whether to run markdownlint auto-fix on the converted Markdown',
					},
					{
						displayName: 'Table First Row as Header',
						name: 'tableFirstRowAsHeader',
						type: 'boolean',
						default: true,
						description: 'Whether to promote the first row of each table to header cells',
					},
					{
						displayName: 'Validate Docx Signature',
						name: 'validateDocxSignature',
						type: 'boolean',
						default: true,
						description: 'Whether to reject binary input that does not start with the .docx (ZIP) magic signature',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const inputBinaryField = this.getNodeParameter('inputBinaryField', i) as string;
				const destinationOutputField = this.getNodeParameter('destinationOutputField', i) as string;
				const removeImages = this.getNodeParameter('removeImages', i) as boolean;
				const options = this.getNodeParameter('options', i, {}) as IDataObject;
				const turndown: Record<string, unknown> = {};
				if (typeof options.headingStyle === 'string') turndown.headingStyle = options.headingStyle;
				if (typeof options.bulletListMarker === 'string') turndown.bulletListMarker = options.bulletListMarker;
				if (typeof options.codeBlockStyle === 'string') turndown.codeBlockStyle = options.codeBlockStyle;

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

				const convertOptions: ConvertOptions = { removeImages, turndown };
				if (options.lintMarkdown === false) convertOptions.lint = false;
				if (options.tableFirstRowAsHeader === false) convertOptions.tableFirstRowAsHeader = false;

				const result = await convert(binaryData, convertOptions);

				returnData.push({
					json: { [destinationOutputField]: result },
					pairedItem: { item: i },
				});
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
