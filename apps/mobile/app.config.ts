import type { ExpoConfig } from 'expo/config';

const appVariant: unknown = process.env.APP_VARIANT ?? 'development';

if (appVariant !== 'development' && appVariant !== 'preview' && appVariant !== 'production') {
  throw new Error(
    `Invalid APP_VARIANT "${String(appVariant)}". Use development, preview, or production.`,
  );
}

const identities = {
  development: {
    name: 'Welyt Dev',
    applicationId: 'com.tapanmeena.welyt.dev',
    scheme: 'welyt-dev',
  },
  preview: {
    name: 'Welyt Preview',
    applicationId: 'com.tapanmeena.welyt.preview',
    scheme: 'welyt-preview',
  },
  production: {
    name: 'Welyt',
    applicationId: 'com.tapanmeena.welyt',
    scheme: 'welyt',
  },
};

const identity = identities[appVariant];

const config: ExpoConfig = {
  name: identity.name,
  slug: 'Welyt-mobile',
  version: '0.1.1',
  scheme: identity.scheme,
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: identity.applicationId,
    supportsTablet: true,
  },
  android: {
    package: identity.applicationId,
    allowBackup: false,
    adaptiveIcon: {
      backgroundColor: '#26333c',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    permissions: ['android.permission.USE_BIOMETRIC', 'android.permission.USE_FINGERPRINT'],
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-router',
    [
      'expo-dev-client',
      {
        launchMode: 'most-recent',
        addGeneratedScheme: appVariant === 'development',
      },
    ],
    '@react-native-community/datetimepicker',
    'expo-font',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 200,
        resizeMode: 'contain',
        backgroundColor: '#26333c',
      },
    ],
    'expo-status-bar',
    [
      'expo-secure-store',
      {
        configureAndroidBackup: true,
        faceIDPermission: 'Allow Welyt to use Face ID to unlock the app.',
      },
    ],
    [
      'expo-local-authentication',
      {
        faceIDPermission: 'Allow Welyt to use Face ID to unlock the app.',
      },
    ],
    'expo-sharing',
    [
      'expo-notifications',
      {
        mode: 'development',
        enableRemoteNotifications: true,
        enableBackgroundRemoteNotifications: false,
      },
    ],
  ],
  extra: {
    router: {
      asyncRoutes: {
        web: true,
      },
    },
    eas: {
      projectId: '38ca27d6-eb6f-4d3f-8f9f-c3bb59e370dc',
    },
  },
  runtimeVersion: {
    policy: 'appVersion',
  },
  updates: {
    url: 'https://u.expo.dev/38ca27d6-eb6f-4d3f-8f9f-c3bb59e370dc',
  },
};

export default config;
