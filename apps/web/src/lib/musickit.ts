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
    script.onerror = () =>
      reject(new Error('无法加载 MusicKit JS，请检查网络或地区限制。'));
    document.head.append(script);
  });
  return scriptPromise;
}

export async function authorizeAppleMusic(developerToken: string): Promise<string> {
  const musicKit = await loadScript();
  if (!instance) {
    instance = await musicKit.configure({
      developerToken,
      app: { name: '渡口', build: '0.2.0' },
    });
  }
  const userToken = await instance.authorize();
  if (!userToken) throw new Error('Apple Music 授权没有完成。');
  return userToken;
}
