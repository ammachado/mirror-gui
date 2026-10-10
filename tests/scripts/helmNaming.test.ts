import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';

let helmAvailable = true;
try {
  execFileSync('helm', ['version', '--short'], { stdio: 'ignore' });
} catch {
  helmAvailable = false;
}

const render = () =>
  execFileSync(
    'helm',
    ['template', 'ocp-oc-mirror-gui', 'charts/mirror-gui', '-n', 'ns1', '--set', 'route.enabled=true'],
    { encoding: 'utf8' },
  );

describe.skipIf(!helmAvailable)('Helm chart resource naming', () => {
  it('names every resource after the release, without a chart-name suffix', () => {
    const names = [...render().matchAll(/^  name: (.+)$/gm)].map(m => m[1]);
    // The cache volume is a second PVC, named after the release with a -cache suffix.
    expect(names).toHaveLength(5);
    expect(names.filter(n => n === 'ocp-oc-mirror-gui')).toHaveLength(4);
    expect(names.filter(n => n === 'ocp-oc-mirror-gui-cache')).toHaveLength(1);
  });

  it('sets the release namespace explicitly on every resource', () => {
    const namespaces = [...render().matchAll(/^  namespace: (.+)$/gm)].map(m => m[1]);
    expect(namespaces).toEqual(['ns1', 'ns1', 'ns1', 'ns1', 'ns1']);
  });
});
