const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isWatch = process.argv.includes('--watch');

// Assets to watch
const staticAssets = [
    { src: '../src/manifest.json', dest: '../dist/manifest.json' },
    { src: '../src/popup.html', dest: '../dist/popup.html' },
    { src: '../src/icons/icon.svg', dest: '../dist/icons/icon.svg' },
    { src: '../src/icons/icon-16.png', dest: '../dist/icons/icon-16.png' },
    { src: '../src/icons/icon-32.png', dest: '../dist/icons/icon-32.png' },
    { src: '../src/icons/icon-48.png', dest: '../dist/icons/icon-48.png' },
    { src: '../src/icons/icon-128.png', dest: '../dist/icons/icon-128.png' },
    { src: '../src/icons/icon-256.png', dest: '../dist/icons/icon-256.png' },
    { src: '../src/icons/icon-512.png', dest: '../dist/icons/icon-512.png' },
    { src: '../src/styles/variables.css', dest: '../dist/styles/variables.css' },
    { src: '../src/styles/popup.css', dest: '../dist/styles/popup.css' },
    { src: '../src/styles/components.css', dest: '../dist/styles/components.css' },
];

// Copy static assets
const copyAssets = () => {
    const copyFile = (src, dest) => {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        console.log(`📄 Copied: ${path.basename(src)}`);
    };

    // Copy static assets
    staticAssets.forEach(({ src, dest }) => {
        copyFile(path.join(__dirname, src), path.join(__dirname, dest));
    });

    // Copy polyfill from node_modules
    copyFile(
        path.join(__dirname, '../node_modules/webextension-polyfill/dist/browser-polyfill.js'),
        path.join(__dirname, '../dist/browser-polyfill.js')
    );
};

// Watch static assets for changes
const watchAssets = () => {
    staticAssets.forEach(({ src, dest }) => {
        const srcPath = path.join(__dirname, src);
        const destPath = path.join(__dirname, dest);

        // Use fs.watchFile with polling for better Docker/WSL compatibility
        fs.watchFile(srcPath, { interval: 1000 }, (curr, prev) => {
            // Check if file was actually modified
            if (curr.mtime !== prev.mtime) {
                console.log(`📝 ${path.basename(srcPath)} changed, copying...`);
                try {
                    fs.copyFileSync(srcPath, destPath);
                    console.log(`✅ Updated: ${path.basename(srcPath)}`);
                } catch (error) {
                    console.error(`❌ Failed to copy ${path.basename(srcPath)}:`, error.message);
                }
            }
        });
    });
    console.log('👁️  Watching static assets for changes (polling mode)...');
};

const buildOptions = {
    entryPoints: [
        path.join(__dirname, '../src/background.ts'),
        path.join(__dirname, '../src/popup.ts')
    ],
    outdir: path.join(__dirname, '../dist'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    sourcemap: isWatch ? 'inline' : false,
    minify: !isWatch,
    logLevel: 'info',
};

// Plugin to enable polling for Docker/WSL compatibility
const pollingPlugin = {
    name: 'polling',
    setup(build) {
        // Enable polling for better Docker/WSL compatibility
        if (isWatch) {
            console.log('🔄 Using polling mode for file watching (Docker/WSL compatibility)');
        }
    },
};

const typecheckPlugin = {
    name: 'typecheck',
    setup(build) {
        build.onStart(() => {
            const { spawnSync } = require('child_process');
            const result = spawnSync('npx', ['tsc', '--noEmit'], {
                cwd: path.join(__dirname, '..'),
                shell: true,
                encoding: 'utf8',
            });
            if (result.status !== 0) {
                const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
                return {
                    errors: [{
                        text: output || 'TypeScript check failed',
                    }],
                };
            }
            return { errors: [] };
        });
    },
};

async function build() {
    try {
        // Copy assets first
        console.log('📦 Copying assets...');
        copyAssets();

        if (isWatch) {
            // Add polling plugin for Docker/WSL
            const watchOptions = {
                ...buildOptions,
                plugins: [pollingPlugin, typecheckPlugin],
            };

            const ctx = await esbuild.context(watchOptions);
            await ctx.watch();

            // Watch static assets too
            watchAssets();

            console.log('👀 Watching for changes...');
        } else {
            await esbuild.build(buildOptions);
            console.log('✅ Build complete');
        }
    } catch (error) {
        console.error('❌ Build failed:', error);
        process.exit(1);
    }
}

build();
