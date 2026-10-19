/** API payload types. Shapes mirror what server/index.ts returns. */

import type { OperationMode } from '@mirror-gui/shared/operationModes';

export type OperationStatus = 'running' | 'success' | 'failed' | 'stopped';

export interface Operation {
  id: string;
  name: string;
  configFile: string;
  /** Absent on records created before modes existed; read as 'mirrorToDisk'. */
  mode?: OperationMode;
  destinationRegistry?: string;
  status: OperationStatus;
  startedAt: string;
  completedAt?: string;
  duration?: number;
  mirrorDestination?: string;
  errorMessage?: string | null;
}

export interface OperationLogs {
  logs?: string;
}

export interface OperationDetails {
  imagesMirrored?: number;
  operatorsMirrored?: number;
  totalSize?: number;
  platformImages?: number;
  additionalImages?: number;
  helmCharts?: number;
  configFile?: string;
  status?: string;
}

export interface OptionalFlagsPayload {
  removeSignatures?: boolean;
  imageTimeout?: string;
  retryDelay?: string;
  retryTimes?: number;
}

export interface StartOperationRequest {
  configFile: string;
  mode?: OperationMode;
  mirrorDestinationSubdir?: string;
  destinationRegistry?: string;
  skipDestTlsVerify?: boolean;
  optionalFlags?: OptionalFlagsPayload;
}

export interface ConfigFile {
  name: string;
  size: string;
}

export interface CatalogInfo {
  name: string;
  url: string;
  description: string;
  digest?: string | null;
  syncedAt?: string | null;
}

export interface DetailedOperator {
  name: string;
  defaultChannel: string;
  allChannels: string[];
}

export interface OperatorDependency {
  packageName: string;
  defaultChannel?: string;
}

export interface CatalogSyncDiffEntry {
  catalog: string;
  newOperators: string[];
  removedOperators: string[];
  updatedOperators: { name: string; addedVersions: string[] }[];
}

export interface CatalogSyncStatus {
  status: 'idle' | 'running' | 'completed' | 'failed';
  lastSyncTime: string | null;
  syncStartTime: string | null;
  successCount: number;
  failedCount: number;
  totalCount: number;
  completedCatalogs: number;
  currentCatalog: string | null;
  error: string | null;
  logs: string[];
  diff: CatalogSyncDiffEntry[];
  /** True when runtime synced catalog data exists (same probe as clear sync). */
  hasRuntimeSyncData?: boolean;
}

export interface Stats {
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  runningOperations: number;
}

export interface SystemStatus {
  ocMirrorVersion: string;
  systemHealth: string;
  pullSecretDetected: boolean;
}

export interface SystemInfo {
  ocMirrorVersion: string;
  systemArchitecture: string;
  availableDiskSpace: number;
  totalDiskSpace: number;
  hostDataDir: string;
  cacheDir: string;
  hostCacheDir: string;
  cacheSizeBytes: number;
}

export interface PullSecretStatus {
  detected: boolean;
  path: string | null;
}

export interface RegistryEntry {
  registry: string;
  username: string;
  hasAuth: boolean;
  status?: 'authenticated' | 'failed' | 'verifying' | 'not_verified';
  error?: string;
}

export interface DestinationCredential {
  registry: string;
  username: string;
  status?: RegistryEntry['status'];
  error?: string;
}

export interface RegistryCredentialsList {
  /** True when the credentials file is mounted from a Secret and cannot be edited in the UI. */
  managedExternally: boolean;
  path: string | null;
  credentials: DestinationCredential[];
  error?: string;
}

export interface NewRegistryCredential {
  registry: string;
  username: string;
  password: string;
}
