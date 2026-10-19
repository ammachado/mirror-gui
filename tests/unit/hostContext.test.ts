import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { HostProvider, useHost, type MirrorGuiHost } from '@mirror-gui/ui/host';

const fakeHost: MirrorGuiHost = {
  request: vi.fn(),
  apiUrl: path => `/base${path}`,
  notify: vi.fn(),
  pagePath: page => `/p/${page}`,
};

function ShowSettingsPath() {
  return createElement('span', null, useHost().pagePath('settings'));
}

describe('HostProvider / useHost', () => {
  it('gives pages the host supplied by the shell', () => {
    const html = renderToString(createElement(HostProvider, { host: fakeHost }, createElement(ShowSettingsPath)));
    expect(html).toContain('/p/settings');
  });

  it('fails loudly when a page renders outside a HostProvider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderToString(createElement(ShowSettingsPath))).toThrow(/HostProvider/);
  });
});
