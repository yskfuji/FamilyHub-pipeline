import { describe, expect, it } from 'vitest';
import { deviceLabel } from '../auth/deviceLabel';

describe('deviceLabel', () => {
  it('names browsers by device and browser', () => {
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1')).toBe('iPhone Safari');
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36')).toBe('Mac Chrome');
    expect(deviceLabel('')).toBe('ブラウザ');
  });

  it('names the iOS app as an app, not a browser', () => {
    expect(deviceLabel('Yoridokoro/0.1 (iPhone; iOS 26.6) FamilyHubApp/0.1')).toBe('iPhone アプリ');
    expect(deviceLabel('Yoridokoro/0.1 (iPad; iOS 26.6) FamilyHubApp/0.1')).toBe('iPad アプリ');
  });

  it('does not trust the app marker on other devices', () => {
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 FamilyHubApp/0.1')).toBe('Windows Chrome');
  });
});
