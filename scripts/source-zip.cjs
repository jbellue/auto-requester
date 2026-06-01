#!/usr/bin/env node
'use strict';

const AdmZip = require('adm-zip');
const path = require('path');
const { execSync } = require('child_process');

const EXCLUDE = new Set(['src/amo-metadata.json']);
const INCLUDE_ROOTS = ['src/', 'scripts/', 'package.json', 'package-lock.json', 'tsconfig.json', 'README.md'];

const tracked = execSync('git ls-files').toString().trim().split('\n');
const files = tracked.filter(f =>
    INCLUDE_ROOTS.some(r => f === r || f.startsWith(r)) &&
    !EXCLUDE.has(f)
);

const zip = new AdmZip();
for (const f of files) {
    const dir = path.dirname(f);
    zip.addLocalFile(f, dir === '.' ? '' : dir);
}

zip.writeZip('source.zip');
console.log(`source.zip created (${files.length} files)`);
