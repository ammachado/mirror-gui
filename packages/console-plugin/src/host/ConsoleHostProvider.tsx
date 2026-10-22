import React, { useCallback, useMemo, useState } from 'react';
import { Alert, AlertActionCloseButton, AlertGroup } from '@patternfly/react-core';
import { HostProvider, type NotifyVariant } from '@mirror-gui/ui/host';
import { createConsoleHost } from './consoleHost';

interface Toast {
  key: number;
  variant: NotifyVariant;
  title: string;
}

/**
 * Supplies the console host to a shared page and renders its toasts.
 * The host is memoized: pages use it in hook dependencies, so a new object on every
 * render would make them refetch in a loop.
 */
export const ConsoleHostProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const remove = useCallback((key: number) => setToasts(current => current.filter(t => t.key !== key)), []);
  const notify = useCallback(
    (variant: NotifyVariant, title: string) => {
      const key = Date.now() + Math.random();
      setToasts(current => [...current, { key, variant, title }]);
      setTimeout(() => remove(key), 8000);
    },
    [remove],
  );
  const host = useMemo(() => createConsoleHost({ notify }), [notify]);

  return (
    <HostProvider host={host}>
      {children}
      <AlertGroup isToast isLiveRegion>
        {toasts.map(t => (
          <Alert key={t.key} variant={t.variant} title={t.title} actionClose={<AlertActionCloseButton onClose={() => remove(t.key)} />} />
        ))}
      </AlertGroup>
    </HostProvider>
  );
};
