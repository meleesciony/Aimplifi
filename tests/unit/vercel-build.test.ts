/**
 * test_regression__vercel_preview_build_skips_db_push_when_database_url_is_unset
 *
 * Preview env vars are Production-only (DEPLOY.md). vercel.json used to run
 * `prisma db push` unconditionally, so every Preview died with
 * "datasource.url property is required" (~16s, before next build) while
 * Production stayed READY. The gated script must skip push (and the
 * Postgres schema) when DATABASE_URL is unset, and keep the Production path
 * when it is set.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function runVercelBuild(databaseUrl: string | undefined): { log: string; stdout: string } {
  const dir = mkdtempSync(join(tmpdir(), 'vercel-build-'));
  const bin = join(dir, 'bin');
  const logPath = join(dir, 'cmds.log');
  mkdirSync(bin);
  const stub = `#!/usr/bin/env bash
printf '%s\\n' "\${0##*/} $*" >> ${JSON.stringify(logPath)}
exit 0
`;
  writeFileSync(join(bin, 'node'), stub, { mode: 0o755 });
  writeFileSync(join(bin, 'npx'), stub, { mode: 0o755 });
  writeFileSync(join(bin, 'next'), stub, { mode: 0o755 });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    HOME: dir,
  };
  if (databaseUrl === undefined) {
    delete env.DATABASE_URL;
  } else {
    env.DATABASE_URL = databaseUrl;
  }

  const stdout = execFileSync('bash', ['scripts/vercel-build.sh'], {
    env,
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  return { log: readFileSync(logPath, 'utf8'), stdout };
}

describe('vercel preview build (DATABASE_URL gate)', () => {
  it('vercel.json routes the build through the gated script, not an inline db push', () => {
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { buildCommand?: string };
    expect(vercel.buildCommand).toBe('bash scripts/vercel-build.sh');
    expect(vercel.buildCommand).not.toMatch(/db push/);
  });

  it('test_regression__vercel_preview_build_skips_db_push_when_database_url_is_unset', () => {
    execFileSync('bash', ['-n', 'scripts/vercel-build.sh']);
    const { log, stdout } = runVercelBuild(undefined);
    expect(stdout).toContain('DATABASE_URL unset');
    expect(log).toContain('prisma generate');
    expect(log).toContain('next build');
    expect(log).not.toMatch(/gen-pg-schema/);
    expect(log).not.toMatch(/db push/);
  });

  it('still generates the postgres schema and pushes when DATABASE_URL is set', () => {
    const { log } = runVercelBuild('postgresql://build:build@127.0.0.1:5432/build');
    expect(log).toMatch(/gen-pg-schema/);
    expect(log).toContain('prisma generate');
    expect(log).toContain('db push');
    expect(log).toContain('next build');
  });
});
