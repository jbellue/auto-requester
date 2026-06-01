const fs = require('fs');
const path = require('path');

// Copy non-TypeScript files to dist
const copyFile = (src, dest) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`Copied: ${src} -> ${dest}`);
};

copyFile('src/manifest.json', 'dist/manifest.json');
copyFile('src/amo-metadata.json', 'dist/amo-metadata.json');
copyFile('src/popup.html', 'dist/popup.html');
copyFile('src/icon.svg', 'dist/icon.svg');
copyFile('src/shared.js', 'dist/shared.js');

console.log('Assets copied successfully!');
