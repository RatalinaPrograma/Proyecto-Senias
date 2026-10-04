import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.ionic.starter',
  appName: 'Signy',
  webDir: 'www',
  android: {
    statusBarOverlaysWebView: true,
    webContentsDebuggingEnabled: false
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_signy',
      iconColor: '#F2701A'
    }
  }
};

export default config;
