// Checks the built extension in dist/ against the project's security rules:
//
//   1. No code that can reach the network or evaluate text as code.
//   2. No address of a remote server anywhere in the build.
//   3. The manifest asks for exactly the agreed permissions and keeps the
//      strict content security policy.
//
// Run after `npm run build`. Exits with status 1 and a list of findings.
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));

const ALLOWED_PERMISSIONS = ['activeTab', 'scripting', 'sidePanel', 'unlimitedStorage'];
const FORBIDDEN_MANIFEST_KEYS = [
  'host_permissions',
  'optional_host_permissions',
  'optional_permissions',
  'content_scripts',
  'web_accessible_resources',
  'sandbox',
  'oauth2',
  'update_url',
];
const REQUIRED_CSP = ["default-src 'none'", "script-src 'self'", "connect-src 'none'", "object-src 'none'"];
const FORBIDDEN_CSP = ["'unsafe-eval'", "'unsafe-inline'", 'http:', 'https:', '*'];

const FORBIDDEN_CODE = [
  ['network request (fetch)', /\bfetch\s*\(/],
  ['network request (XMLHttpRequest)', /\bXMLHttpRequest\b/],
  ['network connection (WebSocket)', /\bWebSocket\b/],
  ['network connection (EventSource)', /\bEventSource\b/],
  ['network connection (WebTransport)', /\bWebTransport\b/],
  ['network connection (RTCPeerConnection)', /\bRTCPeerConnection\b/],
  ['network request (sendBeacon)', /\bsendBeacon\b/],
  ['script loading (importScripts)', /\bimportScripts\s*\(/],
  ['code evaluation (eval)', /\beval\s*\(/],
  ['code evaluation (new Function)', /\bnew\s+Function\s*\(/],
];

// XML namespace names look like addresses but are never contacted.
const ALLOWED_URL_PREFIXES = ['http://schemas.openxmlformats.org/'];
const URL_PATTERN = /\bhttps?:\/\/[^\s"'`)<>\\]+/g;
const TEXT_EXTENSIONS = new Set(['.js', '.html', '.css', '.json']);

const problems = [];

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else yield path;
  }
}

function checkCode() {
  for (const path of files(DIST)) {
    if (!TEXT_EXTENSIONS.has(extname(path))) continue;
    const name = relative(DIST, path);
    const text = readFileSync(path, 'utf8');

    for (const [label, pattern] of FORBIDDEN_CODE) {
      if (pattern.test(text)) problems.push(`${name}: ${label}`);
    }
    for (const url of text.match(URL_PATTERN) ?? []) {
      if (!ALLOWED_URL_PREFIXES.some((prefix) => url.startsWith(prefix))) {
        problems.push(`${name}: remote address ${url}`);
      }
    }
  }
}

function checkManifest() {
  const manifest = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'));

  const permissions = [...(manifest.permissions ?? [])].sort();
  if (JSON.stringify(permissions) !== JSON.stringify([...ALLOWED_PERMISSIONS].sort())) {
    problems.push(`manifest: permissions are [${permissions.join(', ')}], expected [${ALLOWED_PERMISSIONS.join(', ')}]`);
  }
  for (const key of FORBIDDEN_MANIFEST_KEYS) {
    if (key in manifest) problems.push(`manifest: "${key}" is not allowed`);
  }
  if (manifest.externally_connectable?.matches) {
    problems.push('manifest: web pages may not connect to the extension');
  }

  const csp = manifest.content_security_policy?.extension_pages ?? '';
  for (const directive of REQUIRED_CSP) {
    if (!csp.includes(directive)) problems.push(`manifest: the CSP lacks "${directive}"`);
  }
  for (const token of FORBIDDEN_CSP) {
    if (csp.split(/[\s;]+/).includes(token)) problems.push(`manifest: the CSP contains ${token}`);
  }
}

checkCode();
checkManifest();

if (problems.length > 0) {
  console.error(`Build check failed (${problems.length}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log('Build check passed: no network code, no remote addresses, permissions and CSP as agreed.');
