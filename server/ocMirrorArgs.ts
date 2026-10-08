import { pathToFileURL } from 'url';
import { type OperationMode, isRegistryTargetMode } from './operationModes.js';

export interface OcMirrorArgsInput {
  mode: OperationMode;
  configPath: string;
  /** M2D output folder, M2M --workspace, or D2M --from. */
  folderPath: string;
  cacheDir: string;
  authfilePath: string;
  destinationRegistry?: string;
  skipDestTlsVerify?: boolean;
  additionalArgs: string[];
}

/**
 * Builds the oc-mirror v2 argv for one workflow. oc-mirror picks the workflow from the
 * arguments: file:// destination is mirror-to-disk; docker:// with --workspace is
 * mirror-to-mirror; docker:// with --from is disk-to-mirror.
 */
export function buildOcMirrorArgs(input: OcMirrorArgsInput): string[] {
  const folderUrl = pathToFileURL(input.folderPath).href;
  const sharedTail = [
    '--src-tls-verify=false',
    '--cache-dir', input.cacheDir,
    '--authfile', input.authfilePath,
    ...input.additionalArgs,
  ];

  if (!isRegistryTargetMode(input.mode)) {
    return ['--v2', '--config', input.configPath, '--dest-tls-verify=false', ...sharedTail, folderUrl];
  }

  if (!input.destinationRegistry) {
    throw new Error(`destinationRegistry is required for ${input.mode}`);
  }

  const folderFlag = input.mode === 'mirrorToMirror' ? '--workspace' : '--from';
  return [
    '--v2',
    '--config', input.configPath,
    folderFlag, folderUrl,
    `--dest-tls-verify=${input.skipDestTlsVerify === true ? 'false' : 'true'}`,
    ...sharedTail,
    `docker://${input.destinationRegistry}`,
  ];
}
