import React from 'react';
import Dashboard from '@mirror-gui/ui/pages/Dashboard';
import History from '@mirror-gui/ui/pages/History';
import MirrorConfig from '@mirror-gui/ui/pages/MirrorConfig';
import MirrorOperations from '@mirror-gui/ui/pages/MirrorOperations';
import Settings from '@mirror-gui/ui/pages/Settings';
import { ConsoleHostProvider } from './host/ConsoleHostProvider';

// Each console route renders one page on its own, so each needs its own host provider.
const inHost = (Page: React.ComponentType) => () => (
  <ConsoleHostProvider>
    <Page />
  </ConsoleHostProvider>
);

export const DashboardPage = inHost(Dashboard);
export const MirrorConfigPage = inHost(MirrorConfig);
export const MirrorOperationsPage = inHost(MirrorOperations);
export const HistoryPage = inHost(History);
export const SettingsPage = inHost(Settings);
