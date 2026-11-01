import { mkdir, copyFile } from 'node:fs/promises';
const target = new URL('../dist/', import.meta.url);
await mkdir(target, { recursive: true });
for (const name of ['index.html', 'app.js', 'style.css']) await copyFile(new URL(`../public/${name}`, import.meta.url), new URL(name, target));
console.log('Interface preparada em dist/.');
