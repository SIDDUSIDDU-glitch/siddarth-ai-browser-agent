/**
 * Verification Test Suite: Slice 17 (Packaging, Documentation, Release ZIP & Landing Page)
 * Phase 4: Production Polish, Privacy & Release Packaging
 * 
 * Verifies:
 * 1. package.json manifest, NPM scripts (build, package, test, test:phase4), version alignment
 * 2. LICENSE MIT validity and copyright
 * 3. scripts/build-release.js execution & build output verification
 * 4. dist/ unpacked distribution file completeness (all runtime content scripts, tabs, utils, icons)
 * 5. Strict clean-build exclusions (no .env, tests/, .git, or scripts/ in distribution)
 * 6. dist/siddarth-browser-agent-v1.0.0.zip archive existence and non-zero payload
 * 7. manifest.json Manifest V3 schema validity and asset resolution
 * 8. docs/index.html landing page structure, simulator, 4-phase capabilities, security rails, and CTA
 * 9. README.md complete coverage of all 4 Phases, 17 Slices, architecture, and testing guides
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRelease } from '../scripts/build-release.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`  ❌ FAILED: ${message}`);
    throw new Error(message);
  } else {
    console.log(`  ✓ Passed: ${message}`);
    passedTests++;
  }
}

async function runSlice17Tests() {
  console.log('========================================================');
  console.log('Starting Verification Tests: Slice 17 (Packaging & Docs)');
  console.log('========================================================\n');

  // ----------------------------------------------------
  // Test 1: package.json validation & version sync
  // ----------------------------------------------------
  console.log('Test Group 1: package.json & LICENSE Verification');
  const packageJsonPath = path.join(ROOT_DIR, 'package.json');
  assert(fs.existsSync(packageJsonPath), 'package.json must exist in project root');

  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  assert(pkg.name === 'siddarth-browser-agent', 'package name must match siddarth-browser-agent');
  assert(pkg.type === 'module', 'package.json must use type: module');
  assert(pkg.license === 'MIT', 'package.json license must be MIT');
  assert(typeof pkg.scripts === 'object', 'package.json must define scripts');
  assert(Boolean(pkg.scripts.build), 'package.json must have build script');
  assert(Boolean(pkg.scripts.package), 'package.json must have package script');
  assert(Boolean(pkg.scripts.test), 'package.json must have test script');
  assert(Boolean(pkg.scripts['test:phase4']), 'package.json must have test:phase4 script');

  const manifestPath = path.join(ROOT_DIR, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  assert(pkg.version === manifest.version, `package.json version (${pkg.version}) must match manifest.json (${manifest.version})`);

  const licensePath = path.join(ROOT_DIR, 'LICENSE');
  assert(fs.existsSync(licensePath), 'LICENSE file must exist in root');
  const licenseText = fs.readFileSync(licensePath, 'utf-8');
  assert(licenseText.includes('MIT License'), 'LICENSE must be MIT License');
  assert(licenseText.includes('Siddarth'), 'LICENSE must mention Siddarth');

  // ----------------------------------------------------
  // Test 2: Build release tool execution
  // ----------------------------------------------------
  console.log('\nTest Group 2: Automated Release Packager (scripts/build-release.js)');
  const buildResult = buildRelease();
  assert(buildResult.success === true, 'buildRelease() must return success: true');
  assert(typeof buildResult.zipPath === 'string', 'buildRelease() must return valid zipPath');
  assert(fs.existsSync(buildResult.zipPath), 'Generated release ZIP must exist on filesystem');
  assert(buildResult.sizeBytes > 10000, `Generated ZIP size (${buildResult.sizeBytes} bytes) must be > 10 KB`);
  assert(buildResult.filesCount >= 25, `Packaged files count (${buildResult.filesCount}) must be >= 25`);

  // ----------------------------------------------------
  // Test 3: Unpacked Distribution Integrity & Completeness
  // ----------------------------------------------------
  console.log('\nTest Group 3: Unpacked Release Directory File Completeness');
  const unpackedDir = buildResult.unpackedDir;
  assert(fs.existsSync(unpackedDir), 'Unpacked directory dist/siddarth-browser-agent must exist');

  const requiredDistFiles = [
    'manifest.json',
    'README.md',
    'LICENSE',
    'background/service-worker.js',
    'content/scanner.js',
    'content/highlighter.js',
    'content/executor.js',
    'content/readability-bundle.js',
    'sidepanel/index.html',
    'sidepanel/style.css',
    'sidepanel/sidepanel.js',
    'sidepanel/tabs/chat.js',
    'sidepanel/tabs/agent.js',
    'sidepanel/tabs/profile.js',
    'sidepanel/tabs/settings.js',
    'utils/ai-client.js',
    'utils/safety-guard.js',
    'utils/storage-manager.js',
    'utils/youtube-parser.js',
    'lib/Readability.js',
    'lib/marked.min.js',
    'assets/icons/icon16.png',
    'assets/icons/icon32.png',
    'assets/icons/icon48.png',
    'assets/icons/icon128.png'
  ];

  for (const relFile of requiredDistFiles) {
    const fullPath = path.join(unpackedDir, relFile);
    assert(fs.existsSync(fullPath), `Release distribution must contain: ${relFile}`);
  }

  // ----------------------------------------------------
  // Test 4: Exclusion & Secret Isolation Safeguards
  // ----------------------------------------------------
  console.log('\nTest Group 4: Secret & Dev-File Exclusion Verification');
  assert(!fs.existsSync(path.join(unpackedDir, '.env')), 'Release MUST NOT contain .env file');
  assert(!fs.existsSync(path.join(unpackedDir, '.env.example')), 'Release MUST NOT contain .env.example');
  assert(!fs.existsSync(path.join(unpackedDir, 'tests')), 'Release MUST NOT contain tests/ directory');
  assert(!fs.existsSync(path.join(unpackedDir, '.git')), 'Release MUST NOT contain .git directory');
  assert(!fs.existsSync(path.join(unpackedDir, 'scripts')), 'Release MUST NOT contain dev scripts/ directory');
  assert(!fs.existsSync(path.join(unpackedDir, 'package.json')), 'Release runtime root should not include root dev package.json');

  // ----------------------------------------------------
  // Test 5: Manifest V3 Compliance & Asset Resolution in Release
  // ----------------------------------------------------
  console.log('\nTest Group 5: Manifest V3 Compliance of Packaged Distribution');
  const distManifestPath = path.join(unpackedDir, 'manifest.json');
  const distManifest = JSON.parse(fs.readFileSync(distManifestPath, 'utf-8'));

  assert(distManifest.manifest_version === 3, 'Packaged manifest_version must be 3');
  assert(distManifest.permissions.includes('sidePanel'), 'Packaged manifest must declare sidePanel permission');
  assert(distManifest.permissions.includes('storage'), 'Packaged manifest must declare storage permission');
  assert(distManifest.permissions.includes('activeTab'), 'Packaged manifest must declare activeTab permission');
  assert(distManifest.permissions.includes('scripting'), 'Packaged manifest must declare scripting permission');
  assert(distManifest.permissions.includes('contextMenus'), 'Packaged manifest must declare contextMenus permission');
  assert(distManifest.host_permissions.includes('<all_urls>'), 'Packaged manifest must declare <all_urls> host_permissions');

  // Verify background worker file exists
  const swPath = path.join(unpackedDir, distManifest.background.service_worker);
  assert(fs.existsSync(swPath), `Background service worker "${distManifest.background.service_worker}" must exist`);

  // Verify side panel default path exists
  const spPath = path.join(unpackedDir, distManifest.side_panel.default_path);
  assert(fs.existsSync(spPath), `Side panel path "${distManifest.side_panel.default_path}" must exist`);

  // Verify content scripts exist
  for (const cs of distManifest.content_scripts || []) {
    for (const jsFile of cs.js || []) {
      assert(fs.existsSync(path.join(unpackedDir, jsFile)), `Content script "${jsFile}" must exist in release`);
    }
  }

  // Verify icons exist
  for (const iconSize of Object.keys(distManifest.icons || {})) {
    const iconFile = distManifest.icons[iconSize];
    assert(fs.existsSync(path.join(unpackedDir, iconFile)), `Icon "${iconFile}" must exist in release`);
  }

  // ----------------------------------------------------
  // Test 6: GitHub Pages Landing Site (docs/index.html)
  // ----------------------------------------------------
  console.log('\nTest Group 6: Documentation & Landing Site (docs/index.html)');
  const docsPath = path.join(ROOT_DIR, 'docs', 'index.html');
  assert(fs.existsSync(docsPath), 'docs/index.html must exist');

  const docsHtml = fs.readFileSync(docsPath, 'utf-8');
  assert(docsHtml.length > 10000, `docs/index.html must be substantial (>10KB), received ${docsHtml.length} bytes`);
  assert(docsHtml.includes('Siddarth'), 'docs/index.html must include branding name "Siddarth"');
  assert(docsHtml.includes('siddarth-browser-agent-v1.0.0.zip'), 'docs/index.html must include download link for release ZIP');
  assert(docsHtml.includes('Interactive Live Simulator'), 'docs/index.html must include Interactive Simulator');
  assert(docsHtml.includes('Chat &amp; Read') || docsHtml.includes('Chat & Read'), 'docs/index.html must include Chat & Read tab');
  assert(docsHtml.includes('Agent Loop'), 'docs/index.html must include Agent Loop tab');
  assert(docsHtml.includes('Profile &amp; Skills') || docsHtml.includes('Profile & Skills'), 'docs/index.html must include Profile & Skills tab');
  assert(docsHtml.includes('Zero-Compromise Security Architecture'), 'docs/index.html must detail Security Architecture');
  assert(docsHtml.includes('Deterministic Safety Rails'), 'docs/index.html must describe safety rails');
  assert(docsHtml.includes('chrome://extensions'), 'docs/index.html must give Chrome installation instructions');

  // ----------------------------------------------------
  // Test 7: Comprehensive README.md Documentation
  // ----------------------------------------------------
  console.log('\nTest Group 7: Comprehensive README.md Coverage');
  const readmePath = path.join(ROOT_DIR, 'README.md');
  assert(fs.existsSync(readmePath), 'README.md must exist in root');

  const readmeText = fs.readFileSync(readmePath, 'utf-8');
  assert(readmeText.length > 10000, `README.md must be comprehensive (>10KB), received ${readmeText.length} bytes`);
  assert(readmeText.includes('Phase 1: The Eyes'), 'README.md must include Phase 1');
  assert(readmeText.includes('Phase 2: The Brain'), 'README.md must include Phase 2');
  assert(readmeText.includes('Phase 3: The Hands'), 'README.md must include Phase 3');
  assert(readmeText.includes('Phase 4: Production Polish'), 'README.md must include Phase 4');

  for (let s = 1; s <= 17; s++) {
    assert(readmeText.includes(`Slice ${s}:`), `README.md must document Slice ${s}`);
  }

  assert(readmeText.includes('System Architecture & Topology'), 'README.md must include architecture diagram');
  assert(readmeText.includes('Live Testing & Installation Guide'), 'README.md must include installation guide');
  assert(readmeText.includes('Security & Safety Guarantees'), 'README.md must detail security guarantees');
  assert(readmeText.includes('npm test'), 'README.md must include npm test command');
  assert(readmeText.includes('MIT License'), 'README.md must reference MIT License');

  // ----------------------------------------------------
  // Summary
  // ----------------------------------------------------
  console.log('\n========================================================');
  console.log(`ALL VERIFICATION TESTS FOR SLICE 17 PASSED! ✓ (${passedTests}/${totalTests})`);
  console.log('========================================================\n');
}

runSlice17Tests().catch(err => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
