import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';

const result = await build({ entryPoints: ['src/scene.js'], bundle: true, write: false, minify: true, format: 'iife', target: ['es2020'], legalComments: 'inline' });
let page = await readFile('src/page.html', 'utf8');
const icons = [...new Set([...page.matchAll(/\{\{icon:([\w-]+)\}\}/g)].map(match => match[1]))];
for (const name of icons) {
  let svg = await readFile(`node_modules/@phosphor-icons/core/assets/regular/${name}.svg`, 'utf8');
  svg = svg.replace(/<svg /, '<svg aria-hidden="true" focusable="false" ');
  page = page.replaceAll(`{{icon:${name}}}`, svg);
}
const favicon = (await readFile('node_modules/@phosphor-icons/core/assets/regular/bridge.svg', 'utf8')).replace('<svg ', '<svg fill="#a34025" ');
page = page.replace('<!-- FAVICON -->', `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(favicon)}">`);
const licenses = await Promise.all(['three/LICENSE', '@phosphor-icons/core/LICENSE'].map(path => readFile(`node_modules/${path}`, 'utf8')));
page = page.replace('<!doctype html>', `<!doctype html>\n<!-- Third-party licenses\n${licenses.join('\n\n')}\n-->`);
page = page.replace('/* STYLES */', await readFile('src/styles.css', 'utf8'));
page = page.replace('/* APPLICATION */', result.outputFiles[0].text.replaceAll('</script', '<\\/script'));
await writeFile('index.html', page);
console.log(`Built index.html · ${(Buffer.byteLength(page) / 1024).toFixed(0)} KB · standalone, offline ready`);
