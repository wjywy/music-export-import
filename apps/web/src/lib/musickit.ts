interface MusicKitInstance {
  authorize: () => Promise<string>;
  unauthorize?: () => Promise<void>;
}

interface MusicKitGlobal {
  configure: (options: {
    developerToken: string;
    app: { name: string; build: string };
  }) => Promise<MusicKitInstance>;
}

declare global {
  interface Window {
    MusicKit?: MusicKitGlobal;
  }
}

let scriptPromise: Promise<MusicKitGlobal> | null = null;
let instance: MusicKitInstance | null = null;
let configuredToken: string | null = null;

function loadScript(): Promise<MusicKitGlobal> {
  if (window.MusicKit) return Promise.resolve(window.MusicKit);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<MusicKitGlobal>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => {
      if (window.MusicKit) resolve(window.MusicKit);
      else reject(new Error('MusicKit JS 已加载，但没有初始化。'));
    };
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error('无法加载 MusicKit JS，请检查网络或地区限制。'));
    };
    document.head.append(script);
  });
  return scriptPromise;
}

/**
 * Start loading MusicKit before the user clicks connect, so Apple's popup is
 * opened inside the original user gesture.
 */
export function preloadAppleMusic(): void {
  void loadScript().catch(() => {
    // The click handler will retry and surface the real error.
  });
}

/**
 * Must be called from a user gesture: MusicKit opens Apple's authorization popup.
 * The returned music-user-token is posted to the API and encrypted at rest there.
 */
export async function authorizeAppleMusic(
  developerToken: string,
): Promise<string> {
  const musicKit = await loadScript();
  if (!instance || configuredToken !== developerToken) {
    instance = await musicKit.configure({
      developerToken,
      app: { name: '渡口', build: '0.3.0' },
    });
    configuredToken = developerToken;
  }
  const userToken = await instance.authorize();
  if (!userToken) throw new Error('Apple Music 授权没有完成。');
  return userToken;
}
