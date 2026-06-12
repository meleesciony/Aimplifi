import { execSync } from 'node:child_process';

/** Reseed the demo database so e2e runs are deterministic and order-independent. */
export default function globalSetup() {
  execSync('npx prisma db seed', { stdio: 'inherit' });
}
