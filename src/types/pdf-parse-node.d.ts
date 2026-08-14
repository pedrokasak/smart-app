// TypeScript's module resolution ("module": "commonjs" in tsconfig.json,
// no "moduleResolution": "node16"/"nodenext"/"bundler") does not read
// package.json "exports" maps, so it cannot see pdf-parse's "./node"
// subpath even though Node itself resolves it fine at runtime. This
// mirrors just the surface this codebase actually uses from it.
declare module 'pdf-parse/node' {
	export class PDFParse {
		constructor(options: { data: Buffer | Uint8Array });
		getText(): Promise<{ text?: string; document?: string }>;
		destroy(): Promise<void>;
	}
}
