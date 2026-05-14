# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0-beta.0] - 2026-05-14

Pre-release on the `beta` npm tag while the new options bake. Users on
`latest` are not affected. Install with `npm install n8n-nodes-docx-to-md@beta`.

### Added
- `continueOnFail` support — a failing item no longer halts the entire batch.
- Docx signature validation (`PK\x03\x04`) with a legible error for non-docx input.
- `Options` collection in the node UI, alphabetised:
  - **Bullet List Marker** (`-` / `*` / `+`).
  - **Code Block Style** (`fenced` / `indented`).
  - **Custom Style Map** — Mammoth-style mappings as `{from, to}` pairs.
  - **Extract Images** — output embedded images as binary fields.
  - **Heading Style** (`atx` / `setext`).
  - **Image Link Format** (`binaryKey` / `none` / `placeholder`).
  - **Include Raw Text** — attach `rawText` via `mammoth.extractRawText`.
  - **Include Warnings** — attach `warnings[]` from mammoth's `messages`.
  - **Lint Markdown** — opt out of the markdownlint post-pass.
  - **Table First Row as Header** — opt out of the auto-header rewrite.
  - **Validate Docx Signature** — opt out of the magic-byte check.
- Local TypeScript declarations for mammoth/turndown/markdownlint imports.

### Changed
- User-supplied turndown options now override the built-in defaults (previously
  defaults won — `headingStyle` and `bulletListMarker` were effectively
  hardcoded).
- Output items now include `pairedItem: { item: i }` per n8n convention.

### Deprecated
- The top-level `Remove Images` toggle is kept for backward compatibility but is
  ignored when `Options > Extract Images` is on.

## [0.2.1] - 2025-07-11

### Added
- 100% test coverage (37 tests across 6 suites) with Jest + babel-jest for ESM
  modules (markdownlint, micromark).
- Programmatic .docx fixture generator (`tests/fixtures/build-fixtures.js`).

### Fixed
- `convert` now accepts `Buffer` and `ArrayBuffer` inputs in addition to file
  paths.

## [0.2.0] - 2025-07-04

### Added
- `Remove Images` boolean option to strip images from the output Markdown.
- Credentials class scaffold (`DocxToMdCredentialsApi`).
- `usableAsTool: true` so the node can be used inside n8n AI Agent tools.

## [0.1.5] - earlier

### Added
- Initial public release. Converts `.docx` binary to GitHub-flavoured Markdown
  with table auto-headers, anchor preservation, and markdownlint auto-fix.

[0.3.0-beta.0]: https://github.com/sfrangulov/n8n-nodes-docx-to-md/releases/tag/v0.3.0-beta.0
[0.2.1]: https://github.com/sfrangulov/n8n-nodes-docx-to-md/releases/tag/v0.2.1
[0.2.0]: https://github.com/sfrangulov/n8n-nodes-docx-to-md/releases/tag/v0.2.0
[0.1.5]: https://github.com/sfrangulov/n8n-nodes-docx-to-md/releases/tag/v0.1.5
