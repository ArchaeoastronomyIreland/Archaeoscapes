/**

 * Run all astronomy regression tests; exit non-zero on any failure.

 */

import { spawnSync } from 'child_process';

import path from 'path';

import { fileURLToPath } from 'url';



const __dirname = path.dirname(fileURLToPath(import.meta.url));

const tests = [

  'test-time-seconds.mjs',

  'test-time-sun-motion.mjs',

  'test-horizon-disc-visibility.mjs',

  'verify-astro-horizon-integration.mjs',

  'test-path-horizon-geometry.mjs',

  'test-archaeoline-atmosphere.mjs',

  'test-horizon-polyline-match.mjs',

  'test-horizon-relational-fetch.mjs'

];



let failed = 0;

for (const t of tests) {

  const p = path.join(__dirname, t);

  process.stdout.write(`\n=== ${t} ===\n`);

  const r = spawnSync(process.execPath, [p], { stdio: 'inherit', cwd: path.join(__dirname, '..') });

  if (r.status !== 0) {

    failed += 1;

    process.stderr.write(`FAILED: ${t}\n`);

  }

}



if (failed) {

  console.error(`\n${failed}/${tests.length} test suites FAILED`);

  process.exit(1);

}

console.log(`\nAll ${tests.length} test suites passed.`);

