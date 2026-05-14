/** @type {import('jest').Config} */
module.exports = {
	testEnvironment: 'node',
	roots: ['<rootDir>/tests'],
	testMatch: ['**/?(*.)+(test|spec).ts'],
	moduleFileExtensions: ['ts', 'tsx', 'js', 'mjs', 'cjs', 'json', 'node'],
	collectCoverageFrom: [
		'nodes/**/*.ts',
		'credentials/**/*.ts',
		'!**/*.d.ts',
	],
	coverageDirectory: 'coverage',
	coverageReporters: ['text', 'text-summary', 'lcov'],
	coverageThreshold: {
		global: {
			branches: 100,
			functions: 100,
			lines: 100,
			statements: 100,
		},
	},
	// TypeScript test files and source files go through ts-jest.
	// markdownlint ships as ESM (.mjs) — babel-jest transforms those into CJS
	// so Jest's CommonJS runtime can require() them.
	transform: {
		'^.+\\.tsx?$': [
			'ts-jest',
			{
				tsconfig: {
					esModuleInterop: true,
					target: 'es2019',
					module: 'commonjs',
					strict: true,
					resolveJsonModule: true,
				},
			},
		],
		'^.+\\.(mjs|js)$': 'babel-jest',
	},
	// Allow transformation of any node_modules file (markdownlint and its
	// transitive ESM deps need to be transpiled to CommonJS for Jest's runtime).
	transformIgnorePatterns: [],
};
