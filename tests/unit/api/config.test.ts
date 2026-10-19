import { describe, it, expect } from 'vitest';
import { listConfigs, saveConfig, deleteConfig, configDownloadUrl } from '@mirror-gui/ui/api';
import { fakeHost } from './fakeHost';

describe('config client', () => {
  it('lists configurations', async () => {
    const { host, request } = fakeHost([]);
    await listConfigs(host);
    expect(request).toHaveBeenCalledWith('GET', '/config/list', undefined);
  });

  it('saves with the same body shape the server reads ({ config, name })', async () => {
    const { host, request } = fakeHost();
    await saveConfig(host, 'my-config.yaml', 'kind: ImageSetConfiguration');
    expect(request).toHaveBeenCalledWith('POST', '/config/save', {
      body: { config: 'kind: ImageSetConfiguration', name: 'my-config.yaml' },
    });
  });

  it('encodes filenames with reserved characters exactly once', async () => {
    const { host, request } = fakeHost();
    await deleteConfig(host, 'my config #1?.yaml');
    expect(request).toHaveBeenCalledWith('DELETE', '/config/delete/my%20config%20%231%3F.yaml', undefined);
    expect(configDownloadUrl(host, '100%.yaml')).toBe('/proxy/backend/api/config/download/100%25.yaml');
  });
});
