import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';

// The shared pages run under different route prefixes in each host ('/settings' standalone,
// '/mirror-gui/settings' in the console), so they must build every route with host.pagePath().
const eslint = new ESLint();
const PAGE_FILE = 'packages/ui/src/pages/Example.tsx';

async function ruleIds(code: string) {
  const [result] = await eslint.lintText(code, { filePath: PAGE_FILE });
  return result.messages.map(m => m.ruleId);
}

describe('@mirror-gui/ui route boundary', () => {
  it('rejects a hardcoded route in <Link to>', async () => {
    expect(await ruleIds('export const A = () => <Link to="/settings?tab=registry">x</Link>;\n'))
      .toContain('no-restricted-syntax');
  });

  it('rejects a hardcoded route template in <Link to>', async () => {
    expect(await ruleIds('export const A = (t: string) => <Link to={`/settings?tab=${t}`}>x</Link>;\n'))
      .toContain('no-restricted-syntax');
  });

  it('rejects a hardcoded route passed to navigate()', async () => {
    expect(await ruleIds('declare const navigate: (p: string) => void;\nnavigate(\'/settings?tab=pull-secret\');\n'))
      .toContain('no-restricted-syntax');
  });

  it('accepts routes built from host.pagePath()', async () => {
    const code = [
      'declare const host: { pagePath(p: string): string };',
      'declare const navigate: (p: string) => void;',
      'export const A = () => <Link to={`${host.pagePath(\'settings\')}?tab=registry`}>x</Link>;',
      'navigate(`${host.pagePath(\'settings\')}?tab=pull-secret`);',
      '',
    ].join('\n');
    expect(await ruleIds(code)).not.toContain('no-restricted-syntax');
  });
});
