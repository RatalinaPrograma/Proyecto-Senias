import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.ionic.starter',
  appName: 'signy',
  webDir: 'www',
  android: {
    statusBarOverlaysWebView: true,
    webContentsDebuggingEnabled: false
  }
};

export default config;
