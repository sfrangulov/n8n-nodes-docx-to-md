/* eslint-disable */
// One-off generator for minimal .docx fixtures used by the test suite.
// Run via: npm run build:fixtures
//
// The fixtures are committed to git; this script only needs to run when
// you want to change the contents.

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const mammoth = require('mammoth');

const OUT_DIR = __dirname;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

function wrapDocument(body) {
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${body}
  </w:body>
</w:document>`;
}

const SIMPLE_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Code">
    <w:name w:val="Code"/>
  </w:style>
</w:styles>`;

const SIMPLE_NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="bullet"/>
      <w:lvlText w:val="&#x2022;"/>
      <w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="1">
    <w:abstractNumId w:val="1"/>
  </w:num>
</w:numbering>`;

const SIMPLE_DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const SIMPLE_BODY = `
<w:p>
  <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
  <w:r><w:t>Hello World</w:t></w:r>
</w:p>
<w:p>
  <w:r><w:t xml:space="preserve">This is a simple paragraph with </w:t></w:r>
  <w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r>
  <w:r><w:t xml:space="preserve"> text.</w:t></w:r>
</w:p>
<w:p>
  <w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>
  <w:r><w:t>First item</w:t></w:r>
</w:p>
<w:p>
  <w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>
  <w:r><w:t>Second item</w:t></w:r>
</w:p>
<w:p>
  <w:pPr><w:pStyle w:val="Code"/></w:pPr>
  <w:r><w:t>const x = 1;</w:t></w:r>
</w:p>
`;

function tableCell(text) {
	return `
		<w:tc>
			<w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>
			<w:p><w:r><w:t>${text}</w:t></w:r></w:p>
		</w:tc>`;
}

const TABLE_BODY = `
<w:p><w:r><w:t>Table follows:</w:t></w:r></w:p>
<w:tbl>
	<w:tblPr><w:tblW w:w="6000" w:type="dxa"/></w:tblPr>
	<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>
	<w:tr>
		${tableCell('Header A')}
		${tableCell('Header B')}
	</w:tr>
	<w:tr>
		${tableCell('Row 1 A')}
		${tableCell('Row 1 B')}
	</w:tr>
	<w:tr>
		${tableCell('Row 2 A')}
		${tableCell('Row 2 B')}
	</w:tr>
</w:tbl>
`;

// 1x1 transparent PNG
const ONE_PIXEL_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
	'base64',
);

const IMAGE_BODY = `
<w:p><w:r><w:t>Before image.</w:t></w:r></w:p>
<w:p>
	<w:r>
		<w:drawing>
			<wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">
				<wp:extent cx="9525" cy="9525"/>
				<wp:effectExtent l="0" t="0" r="0" b="0"/>
				<wp:docPr id="1" name="Picture 1"/>
				<wp:cNvGraphicFramePr/>
				<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
					<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
						<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
							<pic:nvPicPr>
								<pic:cNvPr id="1" name="Picture 1"/>
								<pic:cNvPicPr/>
							</pic:nvPicPr>
							<pic:blipFill>
								<a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId10"/>
								<a:stretch><a:fillRect/></a:stretch>
							</pic:blipFill>
							<pic:spPr>
								<a:xfrm><a:off x="0" y="0"/><a:ext cx="9525" cy="9525"/></a:xfrm>
								<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
							</pic:spPr>
						</pic:pic>
					</a:graphicData>
				</a:graphic>
			</wp:inline>
		</w:drawing>
	</w:r>
</w:p>
<w:p><w:r><w:t>After image.</w:t></w:r></w:p>
`;

const IMAGE_DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`;

async function buildDocx(name, body, extras = {}) {
	const zip = new JSZip();
	zip.file('[Content_Types].xml', CONTENT_TYPES);
	zip.file('_rels/.rels', ROOT_RELS);
	zip.file('word/document.xml', wrapDocument(body));
	if (extras.documentRels) {
		zip.file('word/_rels/document.xml.rels', extras.documentRels);
	}
	if (extras.numbering) {
		zip.file('word/numbering.xml', extras.numbering);
	}
	if (extras.styles) {
		zip.file('word/styles.xml', extras.styles);
	}
	if (extras.media) {
		for (const [filename, buffer] of Object.entries(extras.media)) {
			zip.file(`word/media/${filename}`, buffer);
		}
	}
	let buf = await zip.generateAsync({ type: 'nodebuffer' });
	if (extras.embedStyleMap) {
		const embedded = await mammoth.embedStyleMap({ buffer: buf }, extras.embedStyleMap);
		buf = embedded.toBuffer();
	}
	const outPath = path.join(OUT_DIR, name);
	fs.writeFileSync(outPath, buf);
	console.log(`wrote ${outPath} (${buf.length} bytes)`);
}

(async () => {
	await buildDocx('simple.docx', SIMPLE_BODY, {
		documentRels: SIMPLE_DOC_RELS,
		numbering: SIMPLE_NUMBERING,
		styles: SIMPLE_STYLES,
		embedStyleMap: "p[style-name='Code'] => pre > code:fresh",
	});
	await buildDocx('with-table.docx', TABLE_BODY);
	await buildDocx('with-image.docx', IMAGE_BODY, {
		documentRels: IMAGE_DOC_RELS,
		media: { 'image1.png': ONE_PIXEL_PNG },
	});
})().catch((err) => {
	console.error(err);
	process.exit(1);
});
