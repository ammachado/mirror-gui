// Shared by the server and the React UI, so it must not import Node modules.

export type OperationMode = 'mirrorToDisk' | 'mirrorToMirror' | 'diskToMirror';

export const OPERATION_MODES: readonly OperationMode[] = ['mirrorToDisk', 'mirrorToMirror', 'diskToMirror'];

export const OPERATION_MODE_LABELS: Record<OperationMode, string> = {
  mirrorToDisk: 'Mirror to disk',
  mirrorToMirror: 'Mirror to mirror',
  diskToMirror: 'Disk to mirror',
};

export function isOperationMode(value: unknown): value is OperationMode {
  return typeof value === 'string' && (OPERATION_MODES as readonly string[]).includes(value);
}

// Modes whose destination is a container registry rather than a local folder.
export function isRegistryTargetMode(mode: OperationMode): boolean {
  return mode === 'mirrorToMirror' || mode === 'diskToMirror';
}

const HOST_LABEL = '[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?';
const REGISTRY_HOST_PATTERN = new RegExp(`^${HOST_LABEL}(?:\\.${HOST_LABEL})*(?::\\d{1,5})?$`);
const PATH_SEGMENT_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export function isValidRegistryHost(value: string): boolean {
  return REGISTRY_HOST_PATTERN.test(value);
}

/** Returns a user-facing error for an invalid `host[:port][/namespace...]` value, or null when valid. */
export function getDestinationRegistryError(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return 'destinationRegistry is required for this mode';
  }
  if (value.includes('://')) {
    return 'destinationRegistry must not include a scheme; enter host[:port]/namespace without docker://';
  }
  if (/\s/.test(value)) {
    return 'destinationRegistry must not contain whitespace';
  }
  if (value.includes('@')) {
    return 'destinationRegistry must not include a digest';
  }
  if (value.endsWith('/')) {
    return 'destinationRegistry must not end with "/"';
  }
  const [host, ...segments] = value.split('/');
  if (!isValidRegistryHost(host)) {
    return 'destinationRegistry host must be a hostname with an optional port, like registry.example.com:5000';
  }
  for (const segment of segments) {
    if (segment.includes(':')) {
      return 'destinationRegistry must not include a tag';
    }
    if (!PATH_SEGMENT_PATTERN.test(segment)) {
      return 'destinationRegistry namespace segments must be lowercase letters and digits, separated by ".", "_", or "-"';
    }
  }
  return null;
}

/** The `host[:port]` part of a destination, which is how auth files key credentials. */
export function getRegistryHost(destination: string): string {
  return destination.split('/')[0];
}
