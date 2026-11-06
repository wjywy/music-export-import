import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function runDeploy(mode = '', withEnv = true) {
  const root = mkdtempSync(join(tmpdir(), 'dukou deploy-'));
  try {
    mkdirSync(join(root, 'scripts')); mkdirSync(join(root, 'bin'));
    copyFileSync(resolve(__dirname, '../../../../scripts/deploy-prod.sh'), join(root, 'scripts/deploy-prod.sh'));
    if (withEnv) writeFileSync(join(root, '.env.production'), 'DUMMY_ONLY=yes\n');
    const log = join(root, 'commands.log');
    writeFileSync(join(root, 'bin/sudo'), '#!/usr/bin/env bash\nexec "$@"\n', { mode: 0o755 });
    writeFileSync(join(root, 'bin/sleep'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(root, 'bin/docker'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$DEPLOY_TEST_LOG"
if [[ "$DEPLOY_TEST_MODE" == build && "$*" == *'build api'* ]]; then exit 1; fi
if [[ "$DEPLOY_TEST_MODE" == web-build && "$*" == *'build web'* ]]; then exit 1; fi
if [[ "$DEPLOY_TEST_MODE" == api && "$*" == *'up -d --wait --wait-timeout 180 mysql api'* ]]; then exit 1; fi
if [[ "$*" == *'exec -T web wget'* ]]; then
  if [[ "$DEPLOY_TEST_MODE" == health ]]; then exit 1; fi
  if [[ "$DEPLOY_TEST_MODE" == not-ready ]]; then printf '{"ok":false}\\n'; exit 0; fi
  printf '{"ok":true}\\n'
fi
`, { mode: 0o755 });
    const result = spawnSync('bash', [join(root, 'scripts/deploy-prod.sh')], { cwd: root, encoding: 'utf8',
      env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`,
        DEPLOY_TEST_MODE: mode, DEPLOY_TEST_LOG: log } });
    let commands = '';
    try { commands = readFileSync(log, 'utf8'); } catch { /* No command should run without the env file. */ }
    return { status: result.status, output: result.stdout + result.stderr, commands };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('deployment builds first, waits for API and recreates web before checking health', () => {
  const result = runDeploy();
  assert.equal(result.status, 0);
  const build = result.commands.indexOf('build api');
  const buildWeb = result.commands.indexOf('build web');
  const api = result.commands.indexOf('up -d --wait --wait-timeout 180 mysql api');
  const web = result.commands.indexOf('up -d --no-deps --force-recreate --wait --wait-timeout 60 web');
  const health = result.commands.indexOf('exec -T web wget');
  assert.ok(build >= 0 && build < buildWeb && buildWeb < api && api < web && web < health);
  assert.equal(/\bdown\b|--volumes|\brm\b/.test(result.commands), false);
  assert.match(result.output, /部署完成/);
});

test('a failed build leaves running services untouched; an unhealthy API does not replace web', () => {
  const build = runDeploy('build');
  assert.notEqual(build.status, 0);
  assert.equal(build.commands.includes('up -d'), false);
  const webBuild = runDeploy('web-build');
  assert.notEqual(webBuild.status, 0);
  assert.equal(webBuild.commands.includes('up -d'), false);
  const api = runDeploy('api');
  assert.notEqual(api.status, 0);
  assert.equal(api.commands.includes('--force-recreate'), false);
});

test('deployment requires configuration and reports a failed post-deploy health check', () => {
  const config = runDeploy('', false);
  assert.notEqual(config.status, 0); assert.equal(config.commands, '');
  const health = runDeploy('health');
  assert.notEqual(health.status, 0);
  assert.equal((health.commands.match(/exec -T web wget/g) ?? []).length, 10);
  assert.equal(health.output.includes('部署完成'), false);
  const notReady = runDeploy('not-ready');
  assert.notEqual(notReady.status, 0);
  assert.equal(notReady.output.includes('部署完成'), false);
});
