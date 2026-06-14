import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const docsDir = path.join(rootDir, 'docs');
const docsAssetsDir = path.join(docsDir, 'assets');
const docsIndexPath = path.join(docsDir, 'index.html');

async function main() {
  const assets = await fs.readdir(docsAssetsDir, { withFileTypes: true });
  const stylesEntry = assets.find(
    (entry) => entry.isFile() && entry.name.startsWith('styles-') && entry.name.endsWith('.css'),
  );

  if (!stylesEntry) {
    console.log('No styles-*.css found in docs/assets. Skipping docs index stylesheet injection.');
    return;
  }

  let html = await fs.readFile(docsIndexPath, 'utf8');
  const stylesheetHref = `./assets/${stylesEntry.name}`;

  if (html.includes(stylesheetHref)) {
    console.log(`Docs index already references ${stylesheetHref}`);
    return;
  }

  const linkTag = `    <link rel="stylesheet" crossorigin href="${stylesheetHref}">`;

  if (!html.includes('</head>')) {
    throw new Error('Unable to inject stylesheet: </head> tag not found in docs/index.html');
  }

  html = html.replace('</head>', `${linkTag}\n  </head>`);
  await fs.writeFile(docsIndexPath, html, 'utf8');

  console.log(`Injected docs stylesheet link: ${stylesheetHref}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
