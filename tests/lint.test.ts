import { lint } from '../nodes/DocxToMd/DocxToMd.node';

describe('lint', () => {
	it('returns clean markdown unchanged (modulo trailing whitespace)', async () => {
		const input = '# Title\n\nBody text.\n';
		const out = await lint(input);
		expect(out).toBe('# Title\n\nBody text.');
	});

	it('auto-fixes simple markdownlint issues', async () => {
		// MD012 — multiple consecutive blank lines should be collapsed.
		const input = '# Title\n\n\n\n\nBody.\n';
		const out = await lint(input);
		// After fixing, there should be no run of three or more newlines in a row.
		expect(out).not.toMatch(/\n{3,}/);
		expect(out).toContain('# Title');
		expect(out).toContain('Body.');
	});

	it('trims trailing whitespace from the result', async () => {
		const out = await lint('# A\n\n\n\n');
		expect(out).toBe(out.trim());
	});

	it('returns a string for empty input', async () => {
		const out = await lint('');
		expect(typeof out).toBe('string');
	});
});
