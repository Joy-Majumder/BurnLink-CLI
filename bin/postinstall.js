#!/usr/bin/env node
// Postinstall: rewrite the npm-generated bin shim so it works in
// stripped-PATH environments (editor subshells, git hooks, cron, launchd).
//
// On npm <= 8: npm generates a `.cmd` on Windows that calls `node <shim>`.
// On POSIX: npm leaves the shebang as `#!/usr/bin/env node`, which fails
// when env can't resolve `node`.
//
// We rewrite the installed shim to use a robust node lookup:
//   1. `node` from PATH (via `where` / `command -v`)
//   2. Common absolute install paths (Homebrew, nvm, system, etc.)
//
// Idempotent: if the shim already has our marker, skip.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const MARKER = '# burnlink-shim-v1';

function npmGlobalBin() {
  try {
    const out = execFileSync('npm', ['bin', '-g'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim();
  } catch (_) {
    return path.join(os.homedir(), '.npm-global', 'bin');
  }
}

function packageName() {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'),
    );
    return pkg.name;
  } catch (_) {
    return 'burnlink';
  }
}

function findNodePOSIX() {
  try {
    const out = execFileSync('sh', ['-c', 'command -v node'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const p = out.trim();
    if (p) return p;
  } catch (_) {}
  for (const p of [
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
    path.join(os.homedir(), '.npm-global/bin/node'),
    path.join(os.homedir(), '.local/bin/node'),
  ]) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch (_) {}
  }
  // nvm: scan ~/.nvm/versions/node/*/bin/node
  try {
    const nvmRoot = path.join(os.homedir(), '.nvm', 'versions', 'node');
    if (fs.existsSync(nvmRoot)) {
      const versions = fs
        .readdirSync(nvmRoot)
        .filter((v) => /^v?\d/.test(v))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      for (let i = versions.length - 1; i >= 0; i--) {
        const candidate = path.join(nvmRoot, versions[i], 'bin', 'node');
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  } catch (_) {}
  // volta / fnm
  for (const root of [
    path.join(os.homedir(), '.volta', 'tools', 'image', 'node'),
    path.join(os.homedir(), '.fnm', 'node-versions'),
  ]) {
    try {
      if (!fs.existsSync(root)) continue;
      const versions = fs
        .readdirSync(root)
        .filter((v) => /^v?\d/.test(v))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      for (let i = versions.length - 1; i >= 0; i--) {
        const candidate = path.join(root, versions[i], 'bin', 'node');
        if (fs.existsSync(candidate)) return candidate;
      }
    } catch (_) {}
  }
  return null;
}

function findNodeWindows() {
  try {
    const out = execFileSync('where', ['node.exe'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const first = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s && /\.exe$/i.test(s));
    if (first) return first;
  } catch (_) {}
  for (const p of [
    'C\\\\Program Files\\\\nodejs\\\\node.exe',
    'C\\\\Program Files (x86)\\\\nodejs\\\\node.exe',
    path.join(process.env.APPDATA || '', 'npm', 'node.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'fnm_multishells', 'node.exe'),
  ]) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (_) {}
  }
  // nvm-windows: %APPDATA%\nvm\v*\node.exe
  try {
    const nvmRoot = path.join(process.env.APPDATA || '', 'nvm');
    if (fs.existsSync(nvmRoot)) {
      const versions = fs
        .readdirSync(nvmRoot)
        .filter((v) => /^v?\d/.test(v))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      for (let i = versions.length - 1; i >= 0; i--) {
        const candidate = path.join(nvmRoot, versions[i], 'node.exe');
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  } catch (_) {}
  // fnm: %LOCALAPPDATA%\fnm\node-versions\<version>\installation\bin\node.exe
  try {
    const fnmRoot = path.join(
      process.env.LOCALAPPDATA || '',
      'fnm',
      'node-versions',
    );
    if (fs.existsSync(fnmRoot)) {
      const versions = fs
        .readdirSync(fnmRoot)
        .filter((v) => /^v?\d/.test(v))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      for (let i = versions.length - 1; i >= 0; i--) {
        const candidate = path.join(
          fnmRoot,
          versions[i],
          'installation',
          'node.exe',
        );
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  } catch (_) {}
  return null;
}

function shEscapePOSIX(p) {
  // Wrap in single quotes, escape any single quotes inside.
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

function shEscapeWindows(p) {
  // cmd.exe: wrap in double quotes, escape any embedded double quotes.
  return `"${p.replace(/"/g, `\\"`)}"`;
}

function rewritePOSIX(shimPath, entryAbs, nodePath) {
  // Replace the symlink with a small bash launcher that uses the resolved
  // node path. We can't symlink to a file referencing an absolute path
  // we'd have to compute at runtime, so we write a tiny launcher file.
  const header =
    '#!/usr/bin/env bash\n' +
    `# ${MARKER}\n` +
    `# Auto-generated by burnlink postinstall. Do not edit.\n` +
    `exec ${shEscapePOSIX(nodePath)} ${shEscapePOSIX(entryAbs)} "$@"\n`;
  fs.unlinkSync(shimPath);
  fs.writeFileSync(shimPath, header, { mode: 0o755 });
}

function rewriteWindows(shimPath, entryAbs, nodePath) {
  const body =
    `@REM ${MARKER}\r\n` +
    `@REM Auto-generated by burnlink postinstall. Do not edit.\r\n` +
    `@ECHO off\r\n` +
    `exec /B ${shEscapeWindows(nodePath)} ${shEscapeWindows(entryAbs)} %*\r\n`;
  fs.writeFileSync(shimPath, body);
}

function main() {
  const binDir = npmGlobalBin();
  const name = packageName();
  const isWindows = process.platform === 'win32';
  const shimName = isWindows ? `${name}.cmd` : name;
  const shimPath = path.join(binDir, shimName);
  if (!fs.existsSync(shimPath)) {
    // Local install — nothing to do, npm won't have created a shim.
    return;
  }
  let existing = '';
  try {
    existing = fs.readFileSync(shimPath, 'utf8');
  } catch (_) {}
  if (existing.includes(MARKER)) {
    // Already rewritten.
    return;
  }
  const nodePath = isWindows ? findNodeWindows() : findNodePOSIX();
  if (!nodePath) {
    console.warn(
      `[burnlink] postinstall: could not locate a node runtime; the shim at ${shimPath} was left unchanged. Install Node.js (>=18) and re-run \`npm i -g burnlink\`.`,
    );
    return;
  }
  // For the entry, resolve relative to the package: the package install root
  // is the bin dir's parent. We require the user to have used the standard
  // npm layout (`npm i -g burnlink` -> `<prefix>/lib/node_modules/burnlink`),
  // so the entry lives at `<prefix>/lib/node_modules/burnlink/bin/burnlink.js`.
  const prefix = path.dirname(binDir);
  const entryAbs = path.join(prefix, 'lib', 'node_modules', name, 'bin', 'burnlink.js');
  if (!fs.existsSync(entryAbs)) {
    // Fallback: assume user did a local install via `npm i burnlink` and the
    // bin shim points at a local node_modules; in that case the existing shim
    // is fine and we don't rewrite.
    return;
  }
  if (isWindows) {
    rewriteWindows(shimPath, entryAbs, nodePath);
  } else {
    rewritePOSIX(shimPath, entryAbs, nodePath);
  }
}

main();