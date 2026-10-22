import { chmod } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('..', import.meta.url);
for (const name of ['cli.js', 'host.js', 'resource.js']) {
  await chmod(new URL(`./dist/entrypoints/${name}`, root), 0o755);
}
