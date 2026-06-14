function parseVersion(versionText) {
  const parts = String(versionText).replace(/^v/i, '').split('.');
  const major = Number.parseInt(parts[0] ?? '0', 10);
  const minor = Number.parseInt(parts[1] ?? '0', 10);
  const patch = Number.parseInt(parts[2] ?? '0', 10);
  return { major, minor, patch };
}

function isNodeVersionSupported(versionText) {
  const { major, minor } = parseVersion(versionText);
  if (major > 20) return true;
  if (major < 20) return false;
  return minor >= 19;
}

function isNpmUserAgent(userAgent) {
  return userAgent.toLowerCase().includes('npm/');
}

const mode = process.argv[2] || 'build';
const nodeVersion = process.versions.node;
const userAgent = process.env.npm_config_user_agent || '';

if (!isNodeVersionSupported(nodeVersion)) {
  console.error(
    `[runtime-check] Unsupported Node.js ${nodeVersion}. Required: >=20.19.0 for this Vite 7 toolchain.`
  );
  console.error('[runtime-check] Please upgrade Node on the build server and rerun the pipeline.');
  process.exit(1);
}

if ((mode === 'install' || mode === 'build') && !isNpmUserAgent(userAgent)) {
  console.error('[runtime-check] Unsupported package manager detected. This project must be installed and built with npm.');
  console.error(`[runtime-check] Detected user agent: ${userAgent || 'unknown'}`);
  console.error('[runtime-check] Use: npm ci && npm run build');
  process.exit(1);
}

console.log(`[runtime-check] OK: Node ${nodeVersion}, mode=${mode}`);
