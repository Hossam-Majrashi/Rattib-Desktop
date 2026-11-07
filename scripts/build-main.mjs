import { build } from 'esbuild';
await build({ entryPoints: { main: 'src/main/main.ts', preload: 'src/main/preload.ts' }, outdir: 'dist', outExtension: { '.js': '.cjs' }, platform: 'node', target: 'node24', format: 'cjs', bundle: true, external: ['electron', 'node-pty'], sourcemap: false });
