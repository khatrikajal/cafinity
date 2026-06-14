import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const serverEntry = path.join(root, 'dist', 'server', 'index.js');
const clientDir = path.join(root, 'dist', 'client');
const clientAssetsDir = path.join(clientDir, 'assets');

const requiredChecks = [
  {
    label: 'server entry',
    path: serverEntry,
    exists: () => fs.existsSync(serverEntry),
  },
  {
    label: 'client directory',
    path: clientDir,
    exists: () => fs.existsSync(clientDir) && fs.statSync(clientDir).isDirectory(),
  },
  {
    label: 'client assets directory',
    path: clientAssetsDir,
    exists: () => fs.existsSync(clientAssetsDir) && fs.statSync(clientAssetsDir).isDirectory(),
  },
];

const missing = requiredChecks.filter((check) => {
  try {
    return !check.exists();
  } catch {
    return true;
  }
});

if (missing.length > 0) {
  console.error('SSR build verification failed. Missing required artifacts:');
  for (const item of missing) {
    console.error(`- ${item.label}: ${item.path}`);
  }
  process.exit(1);
}

const clientAssetFiles = fs.readdirSync(clientAssetsDir);
if (clientAssetFiles.length === 0) {
  console.error(`SSR build verification failed. No files found in ${clientAssetsDir}`);
  process.exit(1);
}

console.log('SSR build verification passed.');
console.log(`- Server entry: ${serverEntry}`);
console.log(`- Client assets: ${clientAssetsDir}`);
console.log(`- Asset files detected: ${clientAssetFiles.length}`);