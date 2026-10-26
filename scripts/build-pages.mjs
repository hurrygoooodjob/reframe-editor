import { mkdir, copyFile, writeFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Build the self-contained editor, then prepare the GitHub Pages /docs folder.
await import('./build.mjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(path.join(root, 'docs'), { recursive: true });
await copyFile(path.join(root, 'dist/index.html'), path.join(root, 'docs/index.html'));
await writeFile(path.join(root, 'docs/.nojekyll'), '');
await cp(path.join(root,'public'),path.join(root,'docs'),{recursive:true});
for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  await copyFile(path.join(root, name), path.join(root, 'docs', name));
}
console.log('GitHub Pages files ready in docs/');
