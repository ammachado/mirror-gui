import React, { useMemo } from 'react';
import type { AlertVariant } from '@patternfly/react-core';
import { HostProvider } from '@mirror-gui/ui/host';
import { useAlerts } from '../AlertContext';
import { createStandaloneHost } from './standaloneHost';

/**
 * Supplies the standalone host to the shared pages. Must render inside AlertProvider.
 * The host is memoized: pages use it in useCallback/useEffect dependencies, so a new
 * object on every render would make them refetch in a loop.
 */
export const StandaloneHostProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { addAlert } = useAlerts();
  const host = useMemo(
    () => createStandaloneHost({ notify: (variant, title) => addAlert(title, variant as AlertVariant) }),
    [addAlert],
  );
  return <HostProvider host={host}>{children}</HostProvider>;
};
