import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IDataObject,
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
import markdownlintRuleHelpers from 'markdownlint-rule-helpers';
import { parse } from 'node-html-parser';

interface ConvertOptions {
	mammoth?: object;
	turndown?: object;
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

// Turndown will add an empty header if the first row
// of the table isn't `<th>` elements. This function
// converts the first row of a table to `<th>` elements
// so that it renders correctly in Markdown.
function autoTableHeaders(html: string): string {
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
function htmlToMd(html: string, options: object = {}): string {
	const turndownService = new TurndownService({
		...options,
		...defaultTurndownOptions,
	});
	turndownService.use(turndownPluginGfm.gfm);
	return turndownService.turndown(html).trim();
}

// Lint the Markdown and correct any issues
async function lint(md: string): Promise<string> {
	const options = {
		strings: {
			'content': md,
		},
	};
	const lintResult = markdownlintSync.lint(options);
	return markdownlintRuleHelpers.applyFixes(md, lintResult['content']).trim();
}

// Converts a Word document to crisp, clean Markdown
export default async function convert(
	input: string | ArrayBuffer,
	options: ConvertOptions = {},
): Promise<string> {
	let inputObj: { path: string } | { buffer: ArrayBuffer };
	if (typeof input === 'string') {
		inputObj = { path: input };
	} else {
		inputObj = { buffer: input };
	}
	const mammothResult = await mammoth.convertToHtml(inputObj, options.mammoth);
	const html = autoTableHeaders(mammothResult.value);
	const md = htmlToMd(html, options.turndown);
	const cleanedMd = await lint(md);
	return cleanedMd;
}

export class DocxToMd implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Docx to Markdown',
		name: 'docxToMd',
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
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: IDataObject[] = [];

		for (let i = 0; i < items.length; i++) {
			const inputBinaryField = this.getNodeParameter('inputBinaryField', i) as string;
			const destinationOutputField = this.getNodeParameter('destinationOutputField', i) as string;

			const binaryData = await this.helpers.getBinaryDataBuffer(i, inputBinaryField);
			if (!binaryData) {
				throw new NodeOperationError(
					this.getNode(),
					`No binary data found for field "${inputBinaryField}"`,
				);
			}

			const result = await convert(binaryData);

			returnData.push({
				json: {
					[destinationOutputField]: result,
				},
			});
		}

		return [this.helpers.returnJsonArray(returnData)];
	}
}
