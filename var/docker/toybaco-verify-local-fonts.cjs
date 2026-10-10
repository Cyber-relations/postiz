'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Unmodified Google Fonts sources, commit 8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5.
// The OFL notice travels with both variable fonts into every image lane.
const ASSETS = Object.freeze({
  'PlusJakartaSans-Regular.ttf': ['89b3fb38aa0d275d7a731d0d817a4f1622b316b4d7fbdedcf02ee9099ff68bc8', 176288],
  'PlusJakartaSans-Italic.ttf': ['9529eb888668b6a3c6dd75b6341a2fc5263fb6c9e788822e6117c29dd9e8b115', 183188],
  'OFL.txt': ['995c7199cab65954f545996326755daee7b63cc6b42b06c13da1f9502ab08a99', 4402],
});
const FONT_DIR = 'apps/frontend/src/fonts/plus-jakarta-sans';
const LAYOUTS = Object.freeze({
  'apps/frontend/src/app/(app)/layout.tsx': ['600', '500'],
  'apps/frontend/src/app/(provider)/layout.tsx': ['600', '500'],
  'apps/frontend/src/app/(extension)/layout.tsx': ['600', '500'],
  'apps/frontend/src/components/new-layout/layout.component.tsx': ['600', '500', '700'],
});
const GOOGLE_IMPORT = "import { Plus_Jakarta_Sans } from 'next/font/google';";
const LOCAL_IMPORT = "import localFont from 'next/font/local';";

function readRegular(root, relative, optional = false) {
  const parts = relative.split('/');
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) {
      if (optional && error.code === 'ENOENT') return null;
      throw error;
    }
    if (stat.isSymbolicLink() || (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) {
      throw new Error(`local font path must be regular: ${relative}`);
    }
  }
  return fs.readFileSync(current);
}

function verifiedAssets(root, directory) {
  const result = [];
  for (const [name, [digest, size]] of Object.entries(ASSETS)) {
    const relative = `${directory}/${name}`;
    const content = readRegular(root, relative);
    if (content.length !== size || crypto.createHash('sha256').update(content).digest('hex') !== digest) {
      throw new Error(`local font pinned bytes differ: ${name}`);
    }
    result.push({ relative, content });
  }
  return result;
}

function googleBlock(weights) {
  return `const jakartaSans = Plus_Jakarta_Sans({\n  weight: [${weights.map(w => `'${w}'`).join(', ')}],\n  style: ['normal', 'italic'],\n  subsets: ['latin'],\n});`;
}

function localBlock(weights) {
  const range = `${Math.min(...weights.map(Number))} ${Math.max(...weights.map(Number))}`;
  return `const jakartaSans = localFont({\n  src: [\n    { path: '../../fonts/plus-jakarta-sans/PlusJakartaSans-Regular.ttf', weight: '${range}', style: 'normal' },\n    { path: '../../fonts/plus-jakarta-sans/PlusJakartaSans-Italic.ttf', weight: '${range}', style: 'italic' },\n  ],\n  display: 'swap',\n});`;
}

function count(source, text) { return source.split(text).length - 1; }

// Return a complete validated plan before the normalizer performs any writes.
// Only the import and font declaration change; owner layout/embedding code is retained.
function planLocalFonts(root, controlRoot) {
  root = path.resolve(root);
  const assets = verifiedAssets(controlRoot, 'postiz/fonts/plus-jakarta-sans');
  const plan = assets.map(({ relative, content }) => {
    const destination = `${FONT_DIR}/${path.basename(relative)}`;
    const before = readRegular(root, destination, true);
    if (before !== null && !before.equals(content)) throw new Error(`local font destination drifted: ${destination}`);
    return { file: path.join(root, destination), before, content };
  });
  for (const [relative, weights] of Object.entries(LAYOUTS)) {
    const before = readRegular(root, relative);
    const source = before.toString('utf8');
    const oldBlock = googleBlock(weights);
    const newBlock = localBlock(weights);
    let output = source;
    if (count(source, GOOGLE_IMPORT) === 1 && count(source, oldBlock) === 1 && count(source, LOCAL_IMPORT) === 0) {
      output = source.replace(GOOGLE_IMPORT, LOCAL_IMPORT).replace(oldBlock, newBlock);
    } else if (!(count(source, LOCAL_IMPORT) === 1 && count(source, newBlock) === 1 && count(source, GOOGLE_IMPORT) === 0)) {
      throw new Error(`local font declaration input drifted: ${relative}`);
    }
    if (/next\/font\/google|Plus_Jakarta_Sans/.test(output)) throw new Error(`unconverted Google font: ${relative}`);
    plan.push({ file: path.join(root, relative), before, content: Buffer.from(output) });
  }
  return plan;
}

function verifyLocalFonts(root) {
  verifiedAssets(root, FONT_DIR);
  for (const [relative, weights] of Object.entries(LAYOUTS)) {
    const source = readRegular(root, relative).toString('utf8');
    if (count(source, LOCAL_IMPORT) !== 1 || count(source, localBlock(weights)) !== 1 || /next\/font\/google|Plus_Jakarta_Sans/.test(source)) {
      throw new Error(`local font runtime declaration differs: ${relative}`);
    }
  }
  return { assets: 3, layouts: 4, googleFontBuildRequests: 0 };
}

function verifyBuiltFonts(root) {
  const result = verifyLocalFonts(root);
  const directory = 'apps/frontend/.next/static/media';
  const expected = Object.entries(ASSETS).filter(([name]) => name.endsWith('.ttf')).map(([, [digest]]) => digest);
  const observed = new Set();
  for (const name of fs.readdirSync(path.join(root, directory))) {
    if (!name.endsWith('.ttf')) continue;
    const content = readRegular(root, `${directory}/${name}`);
    observed.add(crypto.createHash('sha256').update(content).digest('hex'));
  }
  if (expected.some(digest => !observed.has(digest))) throw new Error('compiled local font bytes missing or changed');
  return { ...result, compiledFontBytes: 2 };
}

module.exports = { ASSETS, FONT_DIR, LAYOUTS, GOOGLE_IMPORT, LOCAL_IMPORT, googleBlock, localBlock, planLocalFonts, verifyLocalFonts, verifyBuiltFonts };
if (require.main === module) {
  try {
    const built = process.argv[2] === '--built';
    if (process.argv.length !== (built ? 4 : 3)) throw new Error('usage: verify-local-fonts.cjs [--built] <application root>');
    console.log(`local fonts: PASS ${JSON.stringify((built ? verifyBuiltFonts : verifyLocalFonts)(path.resolve(process.argv[built ? 3 : 2])))}`);
  } catch (error) { console.error(`ERROR: ${error.message}`); process.exitCode = 1; }
}
