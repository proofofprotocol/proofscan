#!/usr/bin/env node
/**
 * Cross-platform script to copy HTML assets to dist/
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'html');
const dest = path.join(__dirname, '..', 'dist', 'html');

fs.cpSync(src, dest, { recursive: true });
console.log('Copied src/html -> dist/html');
