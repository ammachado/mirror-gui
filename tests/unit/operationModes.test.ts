import { describe, it, expect } from 'vitest';
import {
  OPERATION_MODES,
  isOperationMode,
  isRegistryTargetMode,
  isValidRegistryHost,
  getDestinationRegistryError,
  getRegistryHost,
} from '../../server/operationModes.js';

describe('isOperationMode', () => {
  it('accepts exactly the three oc-mirror workflows', () => {
    expect(OPERATION_MODES).toEqual(['mirrorToDisk', 'mirrorToMirror', 'diskToMirror']);
    for (const mode of OPERATION_MODES) {
      expect(isOperationMode(mode)).toBe(true);
    }
  });

  it('rejects other values so typos do not silently fall back to mirror-to-disk', () => {
    expect(isOperationMode('mirrorToMirrors')).toBe(false);
    expect(isOperationMode('')).toBe(false);
    expect(isOperationMode(undefined)).toBe(false);
    expect(isOperationMode(1)).toBe(false);
  });
});

describe('isRegistryTargetMode', () => {
  it('is true only for modes that push to a registry', () => {
    expect(isRegistryTargetMode('mirrorToDisk')).toBe(false);
    expect(isRegistryTargetMode('mirrorToMirror')).toBe(true);
    expect(isRegistryTargetMode('diskToMirror')).toBe(true);
  });
});

describe('isValidRegistryHost', () => {
  it.each(['registry.example.com', 'localhost:6000', 'quay.io', 'my-reg.internal:5000', '10.0.0.5:443'])(
    'accepts %s',
    (host) => expect(isValidRegistryHost(host)).toBe(true),
  );

  it.each(['', 'https://quay.io', 'quay.io/ns', 'reg .com', 'reg:port', '-bad.com', 'reg.com:'])(
    'rejects %s',
    (host) => expect(isValidRegistryHost(host)).toBe(false),
  );
});

describe('getDestinationRegistryError', () => {
  it.each([
    'registry.example.com',
    'localhost:6000',
    'registry.example.com:5000/mirror',
    'registry.example.com/team/ocp-4.18',
    'quay.io/my_org/mirror-repo',
  ])('accepts %s', (value) => {
    expect(getDestinationRegistryError(value)).toBeNull();
  });

  it('requires a value', () => {
    expect(getDestinationRegistryError(undefined)).toMatch(/required/i);
    expect(getDestinationRegistryError('')).toMatch(/required/i);
    expect(getDestinationRegistryError(42)).toMatch(/required/i);
  });

  it('tells the user to drop the scheme, because the server adds docker:// itself', () => {
    expect(getDestinationRegistryError('docker://registry.example.com')).toMatch(/scheme/i);
    expect(getDestinationRegistryError('https://registry.example.com')).toMatch(/scheme/i);
  });

  it('rejects whitespace, digests, tags, and trailing slashes with specific messages', () => {
    expect(getDestinationRegistryError('registry.example.com/ my')).toMatch(/whitespace/i);
    expect(getDestinationRegistryError('registry.example.com/ns@sha256:abc')).toMatch(/digest/i);
    expect(getDestinationRegistryError('registry.example.com/ns:v1')).toMatch(/tag/i);
    expect(getDestinationRegistryError('registry.example.com/ns/')).toMatch(/end with/i);
  });

  it('rejects uppercase or malformed path segments', () => {
    expect(getDestinationRegistryError('registry.example.com/Team')).toMatch(/lowercase/i);
    expect(getDestinationRegistryError('registry.example.com//ns')).toMatch(/lowercase/i);
  });

  it('rejects an invalid host', () => {
    expect(getDestinationRegistryError('bad host/ns')).toMatch(/whitespace/i);
    expect(getDestinationRegistryError('reg:port/ns')).toMatch(/host/i);
  });
});

describe('getRegistryHost', () => {
  it('returns the host[:port] part used to look up credentials', () => {
    expect(getRegistryHost('registry.example.com:5000/team/ocp')).toBe('registry.example.com:5000');
    expect(getRegistryHost('localhost:6000')).toBe('localhost:6000');
  });
});
