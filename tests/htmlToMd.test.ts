import { htmlToMd } from '../nodes/DocxToMd/DocxToMd.node';

describe('htmlToMd', () => {
	it('converts headings and paragraphs to ATX-style markdown', () => {
		const md = htmlToMd('<h1>Title</h1><p>Body</p>');
		expect(md).toContain('# Title');
		expect(md).toContain('Body');
	});

	it('uses dash bullets for unordered lists', () => {
		const md = htmlToMd('<ul><li>one</li><li>two</li></ul>');
		expect(md).toMatch(/^- one$/m);
		expect(md).toMatch(/^- two$/m);
	});

	it('uses fenced code blocks', () => {
		const md = htmlToMd('<pre><code>const x = 1;</code></pre>');
		expect(md).toContain('```');
		expect(md).toContain('const x = 1;');
	});

	it('preserves empty anchor tags that carry only an id', () => {
		const md = htmlToMd('<p>before <a id="section-1"></a>after</p>');
		expect(md).toContain('<a id="section-1"></a>');
	});

	it('does not invoke the preserveAnchors rule for normal links', () => {
		const md = htmlToMd('<p><a href="https://example.com">click</a></p>');
		expect(md).toContain('[click](https://example.com)');
		expect(md).not.toMatch(/<a id=/);
	});

	it('does not invoke the preserveAnchors rule for anchors that have text content', () => {
		// has an id AND text — filter must reject it so turndown renders as a regular link
		const md = htmlToMd('<p><a id="x">label</a></p>');
		expect(md).not.toContain('<a id="x"></a>');
	});

	it('keeps images when removeImages is false (default)', () => {
		const md = htmlToMd('<p><img src="x.png" alt="cat"/></p>');
		expect(md).toContain('![cat](x.png)');
	});

	it('strips images when removeImages is true', () => {
		const md = htmlToMd('<p>before<img src="x.png" alt="cat"/>after</p>', {}, true);
		expect(md).not.toContain('x.png');
		expect(md).not.toContain('![');
		expect(md).toContain('before');
		expect(md).toContain('after');
	});

	it('accepts custom turndown options via the second argument', () => {
		// passing options is a covered branch — just make sure it doesn't crash
		const md = htmlToMd('<h1>X</h1>', { hr: '***' });
		expect(md).toContain('X');
	});

	it('trims trailing whitespace', () => {
		const md = htmlToMd('<p>hi</p>\n\n\n');
		expect(md).toBe(md.trim());
	});
});
