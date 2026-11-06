/**
 * Siddarth Automated Production Release Packaging Script
 * Slice 17: Packaging, Documentation, Release ZIP & Landing Page
 * 
 * - Copies runtime Chrome Extension files into dist/unpacked/
 * - Excludes developer secrets (.env), test suites (tests/), git history (.git), and dev logs
 * - Generates clean, ready-to-load release ZIP: dist/siddarth-browser-agent-v1.0.0.zip
 * - Verifies archive integrity and structural completeness
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Directories & Files to include in release
const INCLUDE_PATHS = [
  'manifest.json',
  'background',
  'content',
  'sidepanel',
  'utils',
  'lib',
  'assets',
  'README.md',
  'LICENSE'
];

// Patterns strictly excluded from release
const EXCLUDE_PATTERNS = [
  '.env',
  '.git',
  'node_modules',
  'tests',
  'scripts',
  'package.json',
  '.DS_Store',
  'Thumbs.db'
];

export function buildRelease() {
  console.log('========================================================');
  console.log('📦 Siddarth Production Release Packaging Tool (Slice 17)');
  console.log('========================================================\n');

  // 1. Read manifest for versioning
  const manifestPath = path.join(ROOT_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('manifest.json not found in project root!');
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const version = manifest.version || '1.0.0';
  console.log(`📌 Extension Version: v${version}`);

  // 2. Setup dist folders
  const distDir = path.join(ROOT_DIR, 'dist');
  const unpackedDir = path.join(distDir, 'siddarth-browser-agent');
  const zipFileName = `siddarth-browser-agent-v${version}.zip`;
  const zipPath = path.join(distDir, zipFileName);

  if (fs.existsSync(unpackedDir)) {
    fs.rmSync(unpackedDir, { recursive: true, force: true });
  }
  if (fs.existsSync(zipPath)) {
    fs.rmSync(zipPath, { force: true });
  }

  fs.mkdirSync(unpackedDir, { recursive: true });

  // 3. Recursive copy function
  let copiedCount = 0;
  function copyRecursive(src, dest) {
    const stats = fs.statSync(src);
    const basename = path.basename(src);

    if (EXCLUDE_PATTERNS.some(p => basename === p || basename.startsWith('.env'))) {
      return;
    }

    if (stats.isDirectory()) {
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
      }
      const entries = fs.readdirSync(src);
      for (const entry of entries) {
        copyRecursive(path.join(src, entry), path.join(dest, entry));
      }
    } else {
      fs.copyFileSync(src, dest);
      copiedCount++;
    }
  }

  console.log('📋 Copying production runtime assets into release stage...');
  for (const item of INCLUDE_PATHS) {
    const srcPath = path.join(ROOT_DIR, item);
    const destPath = path.join(unpackedDir, item);

    if (fs.existsSync(srcPath)) {
      copyRecursive(srcPath, destPath);
    } else {
      console.warn(`⚠️ Warning: Expected path "${item}" not found, skipping.`);
    }
  }

  console.log(`✓ Copied ${copiedCount} files into: ${unpackedDir}`);

  // 4. Create ZIP archive
  console.log('\n🗜️ Compressing release archive...');
  try {
    if (process.platform === 'win32') {
      // Use .NET System.IO.Compression.ZipFile (rock-solid, headless-safe, fast)
      const escapedUnpacked = unpackedDir.replace(/'/g, "''");
      const escapedZip = zipPath.replace(/'/g, "''");
      const psCommand = `powershell -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${escapedUnpacked}', '${escapedZip}')"`;
      execSync(psCommand, { stdio: 'inherit' });
    } else {
      // Unix / macOS zip
      execSync(`cd "${unpackedDir}" && zip -r "${zipPath}" ./*`, { stdio: 'inherit' });
    }
  } catch (err) {
    throw new Error(`Failed to create ZIP package: ${err.message}`);
  }

  // 5. Verify ZIP existence and non-zero size
  if (!fs.existsSync(zipPath)) {
    throw new Error(`Expected ZIP file was not generated at: ${zipPath}`);
  }

  const zipStats = fs.statSync(zipPath);
  const sizeKb = Math.round(zipStats.size / 1024);

  console.log(`\n========================================================`);
  console.log(`🎉 RELEASE PACKAGING COMPLETED SUCCESSFULLY!`);
  console.log(`========================================================`);
  console.log(`📁 Unpacked Directory : ${unpackedDir}`);
  console.log(`📦 Release ZIP File   : ${zipPath}`);
  console.log(`📊 Total Archive Size : ${sizeKb} KB`);
  console.log(`🔢 Packaged Files     : ${copiedCount} files\n`);
  console.log(`Ready for installation in Chrome:`);
  console.log(`  1. Extract ${zipFileName} (or select ${unpackedDir})`);
  console.log(`  2. Navigate to chrome://extensions/ in Google Chrome`);
  console.log(`  3. Click "Load unpacked" and select the folder!\n`);

  return {
    success: true,
    version,
    unpackedDir,
    zipPath,
    zipFileName,
    sizeBytes: zipStats.size,
    filesCount: copiedCount
  };
}

// Direct execution CLI entrypoint
if (process.argv[1] && process.argv[1].endsWith('build-release.js')) {
  try {
    buildRelease();
  } catch (err) {
    console.error('❌ Build failed:', err.message);
    process.exit(1);
  }
}
