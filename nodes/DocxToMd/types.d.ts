declare module '@joplin/turndown' {
	export default class TurndownService {
		constructor(options?: Record<string, unknown>);
		use(plugin: unknown): TurndownService;
		addRule(name: string, rule: { filter: unknown; replacement: (...args: unknown[]) => string }): TurndownService;
		turndown(html: string): string;
	}
}

declare module '@joplin/turndown-plugin-gfm' {
	export const gfm: unknown;
}

declare module 'markdownlint/sync' {
	export function lint(options: { strings: Record<string, string> }): Record<string, unknown>;
}

declare module 'markdownlint' {
	export function applyFixes(content: string, errors: unknown): string;
}
