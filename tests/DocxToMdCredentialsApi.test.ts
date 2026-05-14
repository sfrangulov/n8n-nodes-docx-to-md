import { DocxToMdCredentialsApi } from '../credentials/DocxToMdCredentialsApi.credentials';

describe('DocxToMdCredentialsApi', () => {
	const cred = new DocxToMdCredentialsApi();

	it('uses the expected credential identifiers', () => {
		expect(cred.name).toBe('docxToMdCredentialsApi');
		expect(cred.displayName).toBe('DocxToMarkdown Credentials API');
		expect(cred.documentationUrl).toMatch(/^https:\/\//);
	});

	it('declares no required properties (compat-only credential)', () => {
		expect(Array.isArray(cred.properties)).toBe(true);
		expect(cred.properties).toHaveLength(0);
	});
});
