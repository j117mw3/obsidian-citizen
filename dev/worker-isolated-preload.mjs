// Verification-only preload: preserve the checkout's existing Worker state.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const originalSpawn = childProcess.spawn;
childProcess.spawn = function(command, args, options) {
  if (Array.isArray(args) && args.some(arg => typeof arg === 'string' && /wrangler[\\/]bin[\\/]wrangler\.js$/.test(arg)) && args.includes('dev')) {
    const state = mkdtempSync(join(tmpdir(), 'citizen-docking-worker-'));
    args = [...args, '--persist-to', state];
    console.log('Using isolated Worker test state: ' + state);
  }
  return originalSpawn.call(this, command, args, options);
};
syncBuiltinESMExports();
