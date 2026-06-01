#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');

const WATCH_DIRS = ['src', 'tests'];
const DEBOUNCE_MS = 300;

const STEPS = [
    { label: 'typecheck', cmd: 'npx tsc --noEmit' },
    { label: 'test',      cmd: 'npx vitest run' },
    { label: 'build',     cmd: 'node scripts/build.cjs' },
    { label: 'xpi',       cmd: 'npx web-ext build --source-dir dist --artifacts-dir web-ext-artifacts --overwrite-dest' },
];

let debounceTimer = null;
let currentChild = null;
let runCounter = 0;

function runStep(cmd) {
    return new Promise((resolve) => {
        const child = spawn(cmd, { stdio: ['ignore', 'inherit', 'inherit'], shell: true });
        currentChild = child;
        child.on('close', (code) => {
            if (currentChild === child) currentChild = null;
            resolve(code);
        });
    });
}

async function runPipeline(id) {
    const divider = '─'.repeat(50);
    console.log(`\n${divider}`);
    console.log(`Pipeline started at ${new Date().toLocaleTimeString()}`);
    console.log(divider);

    for (const step of STEPS) {
        if (id !== runCounter) {
            console.log(`\n[${step.label}] Cancelled`);
            return;
        }

        console.log(`\n[${step.label}]`);
        const code = await runStep(step.cmd);

        if (id !== runCounter) {
            console.log(`[${step.label}] Cancelled`);
            return;
        }

        if (code !== 0) {
            console.log(`\n${divider}`);
            console.log(`Pipeline stopped at [${step.label}].`);
            console.log(divider);
            return;
        }

        console.log(`[${step.label}] PASSED`);
    }

    console.log(`\n${divider}`);
    console.log('All steps passed.');
    console.log(divider);
}

function startRun() {
    if (currentChild) {
        currentChild.kill();
        currentChild = null;
    }
    const id = ++runCounter;
    runPipeline(id);
}

function scheduleRun() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(startRun, DEBOUNCE_MS);
}

for (const dir of WATCH_DIRS) {
    if (!fs.existsSync(dir)) continue;
    fs.watch(dir, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        if (!/\.(ts|json)$/.test(filename)) return;
        console.log(`\nChange: ${dir}/${filename}`);
        scheduleRun();
    });
    console.log(`Watching ${dir}/`);
}

startRun();
