const fs = require('fs');
const path = require('path');

// Copy webextension-polyfill to dist
const src = path.join(__dirname, '../node_modules/webextension-polyfill/dist/browser-polyfill.js');
const dest = path.join(__dirname, '../dist/browser-polyfill.js');

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
console.log('Copied: webextension-polyfill -> dist/browser-polyfill.js');
