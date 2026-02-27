#!/usr/bin/env node
const API = process.env.ENVBURN_API || 'http://localhost:3000';

async function main() {
    const cmd = process.argv[2];
    if (cmd === 'stats') {
        const r = await fetch(API + '/health');
        console.log(await r.json());
    } else if (cmd === 'create') {
        console.log('EnvBurn CLI - create command');
    } else {
        console.log('envburn [stats|create]');
    }
}
main();
