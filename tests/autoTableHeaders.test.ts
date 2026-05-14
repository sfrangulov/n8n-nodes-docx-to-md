import { autoTableHeaders } from '../nodes/DocxToMd/DocxToMd.node';

describe('autoTableHeaders', () => {
	it('promotes <td> cells in the first row to <th>', () => {
		const html =
			'<table><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></table>';
		const out = autoTableHeaders(html);
		expect(out).toContain('<tr><th>A</th><th>B</th></tr>');
		// non-first row stays as <td>
		expect(out).toContain('<tr><td>1</td><td>2</td></tr>');
	});

	it('leaves a table alone when the first row already has <th>', () => {
		const html =
			'<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>';
		const out = autoTableHeaders(html);
		expect(out).toContain('<tr><th>A</th><th>B</th></tr>');
		expect(out).toContain('<tr><td>1</td><td>2</td></tr>');
	});

	it('handles HTML without any tables', () => {
		const html = '<p>hello</p>';
		expect(autoTableHeaders(html)).toContain('<p>hello</p>');
	});

	it('processes multiple tables in the same document', () => {
		const html =
			'<table><tr><td>X</td></tr></table><p>middle</p><table><tr><td>Y</td></tr></table>';
		const out = autoTableHeaders(html);
		expect(out).toContain('<th>X</th>');
		expect(out).toContain('<th>Y</th>');
	});
});
