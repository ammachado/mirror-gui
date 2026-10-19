import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

// The console plugin builds @mirror-gui/ui on its own, so the package must declare every
// package it imports instead of relying on what the standalone app hoists into node_modules.
const UI_ROOT = path.resolve(__dirname, '../../packages/ui');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** 'highlight.js/lib/core' -> 'highlight.js', '@patternfly/react-core/dist/x' -> '@patternfly/react-core'. */
function packageName(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function importedPackages(): string[] {
  const names = new Set<string>();
  for (const file of sourceFiles(path.join(UI_ROOT, 'src'))) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bfrom\s+'([^'.][^']*)'|\bimport\s+'([^'.][^']*)'/g)) {
      names.add(packageName(match[1] ?? match[2]));
    }
  }
  return [...names].sort();
}

describe('@mirror-gui/ui package manifest', () => {
  it('declares every package its sources import', () => {
    const manifest = JSON.parse(readFileSync(path.join(UI_ROOT, 'package.json'), 'utf8'));
    const declared = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ]);
    expect(importedPackages().filter(name => !declared.has(name))).toEqual([]);
  });
});
