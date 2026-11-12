import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { obsidianStyles } from './packages/obsidian-plugin/src/theme.js';
import { CSS as practiceCSS } from './packages/practice/src/styles.js';
import { CSS as gameCSS } from './packages/practice/src/game/styles.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const audioManifest = JSON.parse(await readFile(resolve(root, 'assets/audio/kbsim/manifest.json'), 'utf8'));
const samples = {};
for (const file of audioManifest.files.filter(item => item.path.endsWith('.mp3'))) {
  const data = await readFile(resolve(root, 'assets/audio/kbsim', file.path));
  if (createHash('sha256').update(data).digest('hex') !== file.sha256) throw new Error('Audio checksum mismatch: ' + file.path);
  const [pack, , name] = file.path.split('/');
  (samples[pack] ??= {})[name.replace('.mp3', '')] = data.toString('base64');
}
const audioSource = 'export { createAudioPlayer } from "./packages/practice/src/audio-player.js";\nexport const samples = ' + JSON.stringify(samples) + ';\n';

const bundledAudio = {
  name: 'bundled-audio',
  setup(b) {
    b.onResolve({ filter: /^typefeel:audio$/ }, args => ({ path: args.path, namespace: 'typefeel-audio' }));
    b.onLoad({ filter: /.*/, namespace: 'typefeel-audio' }, () => ({
      contents: audioSource, resolveDir: root, loader: 'js'
    }));
  }
};

const result = await build({
  entryPoints: ['packages/obsidian-plugin/src/main.js'],
  bundle: true,
  platform: 'browser',
  target: ['es2022'],
  format: 'cjs',
  minify: true,
  write: false,
  loader: { '.svg': 'dataurl' },
  external: ['obsidian'],
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [bundledAudio]
});

let code = result.outputFiles[0].text;
if (/\(\?<[=!]/.test(code)) throw new Error('Regular expression lookbehind is unsupported before iOS 16.4');
code = code
  .replace(/createElement\((['"])script\1\)/g, 'createElement($1template$1)')
  .replace(/innerHTML\s*=\s*(['"])<script><\/script>\1/g, 'innerHTML=$1<template></template>$1');

await writeFile(resolve(root, 'main.js'), '// Generated from typefeel; do not edit. Source: https://github.com/yishan/typefeel\n' + code);
await writeFile(resolve(root, 'styles.css'), '/* Generated from typefeel; do not edit. */\n' + obsidianStyles(practiceCSS + gameCSS));
console.log('Built main.js and styles.css');
