import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.zenith.fitness',
  appName: 'Zenith Fitness',
  webDir: 'dist',
  server: {
    // Load from Firebase Hosting so OAuth redirects work correctly in the WebView.
    // The app requires internet for auth and cloud sync regardless.
    url: 'https://zenith-fitness-18e2a.web.app',
    cleartext: false,
  },
  android: {
    allowMixedContent: true,
  },
  plugins: {
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0f0f0f',
    },
  },
};

export default config;
