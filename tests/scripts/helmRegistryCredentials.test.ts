import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';

let helmAvailable = true;
try {
  execFileSync('helm', ['version', '--short'], { stdio: 'ignore' });
} catch {
  helmAvailable = false;
}

const render = (...sets: string[]) =>
  execFileSync(
    'helm',
    ['template', 't', 'charts/mirror-gui', ...sets.flatMap(s => ['--set-string', s])],
    { encoding: 'utf8' },
  );

// The app treats OC_MIRROR_REGISTRY_CREDENTIALS as a read-only external file, so the chart
// must only set it when a Secret is mounted, and must mount that Secret read-only.
describe.skipIf(!helmAvailable)('Helm chart destination registry credentials', () => {
  it('renders nothing by default so credentials stay app-managed', () => {
    const out = render();
    expect(out).not.toContain('OC_MIRROR_REGISTRY_CREDENTIALS');
    expect(out).not.toContain('registry-credentials');
  });

  it('mounts the Secret read-only and points the env var at the key', () => {
    const out = render('registryCredentials.existingSecret=dest-creds');
    expect(out).toMatch(/name: OC_MIRROR_REGISTRY_CREDENTIALS\n\s+value: \/app\/registry-credentials\/auth\.json/);
    expect(out).toMatch(/- name: registry-credentials\n\s+mountPath: \/app\/registry-credentials\n\s+readOnly: true/);
    expect(out).toMatch(/secretName: dest-creds\n\s+items:\n\s+- key: auth\.json\n\s+path: auth\.json/);
  });

  it('honors a custom key', () => {
    const out = render('registryCredentials.existingSecret=dest-creds', 'registryCredentials.key=config.json');
    expect(out).toContain('value: /app/registry-credentials/config.json');
    expect(out).toMatch(/- key: config\.json\n\s+path: config\.json/);
  });
});
