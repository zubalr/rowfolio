#!/usr/bin/env node
/** CI/test helper: fail if src/types.ts differs from a fresh schema regeneration. */
import console from 'node:console';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const result = spawnSync(process.execPath, [join(here, 'generate-types.mjs'), '--check'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
