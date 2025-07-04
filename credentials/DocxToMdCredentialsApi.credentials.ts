import { ICredentialType, INodeProperties } from 'n8n-workflow';

export class DocxToMdCredentialsApi implements ICredentialType {
	name = 'docxToMdCredentialsApi';
	displayName = 'DocxToMarkdown Credentials API';
	documentationUrl = 'https://github.com/sfrangulov/n8n-nodes-docx-to-md';
	properties: INodeProperties[] = [
		// Пустой массив свойств для совместимости - эта нода не требует учетных данных
	];
}
