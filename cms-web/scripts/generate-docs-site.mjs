// Cafinity rebrand — logo + favicon update
import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const distClientDir = path.join(rootDir, 'dist', 'client');
const distAssetsDir = path.join(distClientDir, 'assets');
const docsDir = path.join(rootDir, 'docs');
const docsAssetsDir = path.join(docsDir, 'assets');
const publicDir = path.join(rootDir, 'public');

async function ensureDirectory(directoryPath) {
  await fs.mkdir(directoryPath, { recursive: true });
}

async function copyDirectoryContents(sourceDir, targetDir) {
  try {
    const entries = await fs.readdir(sourceDir, { withFileTypes: true });

    for (const entry of entries) {
      const sourcePath = path.join(sourceDir, entry.name);
      const targetPath = path.join(targetDir, entry.name);

      if (entry.isDirectory()) {
        await copyDirectoryContents(sourcePath, targetPath);
      } else if (entry.isFile()) {
        await ensureDirectory(path.dirname(targetPath));
        await fs.copyFile(sourcePath, targetPath);
      }
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return;
    }

    throw error;
  }
}

async function main() {
  const distEntries = await fs.readdir(distAssetsDir, { withFileTypes: true });
  const jsEntry = distEntries.find((entry) => entry.isFile() && entry.name.startsWith('index-') && entry.name.endsWith('.js'));
  const cssEntry = distEntries.find((entry) => entry.isFile() && entry.name.startsWith('styles-') && entry.name.endsWith('.css'));

  if (!jsEntry) {
    throw new Error(`Unable to find the main client bundle in ${distAssetsDir}`);
  }

  if (!cssEntry) {
    throw new Error(`Unable to find the stylesheet bundle in ${distAssetsDir}`);
  }

  await ensureDirectory(docsDir);
  await fs.rm(docsAssetsDir, { recursive: true, force: true });
  await ensureDirectory(docsAssetsDir);

  await copyDirectoryContents(distAssetsDir, docsAssetsDir);
  await copyDirectoryContents(publicDir, docsDir);

  const html = `<!doctype html>
<html lang="en" class="h-full">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="application-name" content="Cafinity" />
    <meta name="apple-mobile-web-app-title" content="Cafinity" />
    <meta name="theme-color" content="#3b82f6" />
    <link rel="icon" type="image/x-icon" href="/favicon.ico" />
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/site.webmanifest" />
    <link rel="stylesheet" href="./assets/${cssEntry.name}" />
    <title>Cafinity</title>
  </head>
  <body class="h-full bg-gray-50 dark:bg-gray-950 antialiased">
    <div id="root" class="h-full"></div>
    <script>
      window.$_TSR = window.$_TSR || {
        initialized: false,
        buffer: [],
        t: new Map(),
        h() {},
        router: {
          matches: [],
          manifest: { routesById: {} },
          dehydratedData: {},
          lastMatchId: null,
        },
      };

      if (!window.$_TSR.router) {
        window.$_TSR.router = {
          matches: [],
          manifest: { routesById: {} },
          dehydratedData: {},
          lastMatchId: null,
        };
      }
    </script>
    <script type="module" src="./assets/${jsEntry.name}"></script>
  </body>
</html>
`;

  await fs.writeFile(path.join(docsDir, 'index.html'), html, 'utf8');

  console.log('Docs site generated successfully.');
  console.log(`- ${path.join(docsDir, 'index.html')}`);
  console.log(`- ${docsAssetsDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});