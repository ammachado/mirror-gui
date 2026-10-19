import { useMemo } from 'react';
import { useHost } from '../host/HostContext';
import type { MirrorGuiHost } from '../host/types';
import * as catalogs from './catalogs';
import * as config from './config';
import * as operations from './operations';
import * as settings from './settings';
import * as system from './system';

const endpoints = { ...operations, ...config, ...catalogs, ...system, ...settings };

type Endpoints = typeof endpoints;

type BoundToHost<F> = F extends (host: MirrorGuiHost, ...args: infer A) => infer R ? (...args: A) => R : never;

/** The client with the host argument already supplied. */
export type Api = { [K in keyof Endpoints]: BoundToHost<Endpoints[K]> };

export function bindApi(host: MirrorGuiHost): Api {
  const bound = Object.entries(endpoints).map(([name, fn]) => [
    name,
    (...args: unknown[]) => (fn as (h: MirrorGuiHost, ...rest: unknown[]) => unknown)(host, ...args),
  ]);
  return Object.fromEntries(bound) as Api;
}

/** The API client for the current host. Stable as long as the host object is stable. */
export function useApi(): Api {
  const host = useHost();
  return useMemo(() => bindApi(host), [host]);
}

export * from './types';
export * from './operations';
export * from './config';
export * from './catalogs';
export * from './system';
export * from './settings';
