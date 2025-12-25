import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts', 'src/next.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    minify: false, // Keep readable for now, or true for prod. SDK usually false/true depends.
    splitting: false,
    treeshake: true,
    outDir: 'dist',
});
