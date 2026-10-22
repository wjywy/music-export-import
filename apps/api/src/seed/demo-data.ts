import { Platform } from '../common/platforms';

export interface DemoTrack {
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
}

export interface DemoPlaylist {
  title: string;
  description: string;
  platform: Platform;
  tracks: DemoTrack[];
}

export const DEMO_PLAYLISTS: DemoPlaylist[] = [
  {
    title: '深夜渡口',
    description: '夜里两点，城市只剩下水声。适合把灯关掉，把音量调到刚好听得见。',
    platform: 'netease',
    tracks: [
      { title: '晴天', artist: '周杰伦', album: '叶惠美', durationMs: 269_000 },
      { title: '富士山下', artist: '陈奕迅', album: 'What’s Going On…?', durationMs: 259_000 },
      { title: '暧昧', artist: '王菲', album: 'Di-Dar', durationMs: 262_000 },
      { title: '天空之城', artist: '李志', album: 'F', durationMs: 295_000 },
      { title: '平凡之路', artist: '朴树', album: '猎户星座', durationMs: 302_000 },
      {
        title: '杀死那个石家庄人',
        artist: '万能青年旅店',
        album: '万能青年旅店',
        durationMs: 336_000,
      },
      { title: '大风吹', artist: '草东没有派对', album: '丑奴儿', durationMs: 218_000 },
      { title: '爱人错过', artist: '告五人', album: '我肯定在几百年前就说过爱你', durationMs: 216_000 },
      { title: '海浪', artist: 'deca joins', album: '浴室', durationMs: 291_000 },
      { title: '小半', artist: '陈粒', album: '小梦大半', durationMs: 269_000 },
    ],
  },
  {
    title: '通勤路上',
    description: '从家门口到工位，一共十一站。这张歌单刚好听完。',
    platform: 'qq',
    tracks: [
      { title: '温柔', artist: '五月天', album: '人生海海', durationMs: 267_000 },
      { title: '遇见', artist: '孙燕姿', album: 'The Moment', durationMs: 210_000 },
      { title: '伟大的渺小', artist: '林俊杰', album: '伟大的渺小', durationMs: 270_000 },
      { title: '泡沫', artist: '邓紫棋', album: 'Xposed', durationMs: 258_000 },
      { title: '演员', artist: '薛之谦', album: '绅士', durationMs: 261_000 },
      { title: '小幸运', artist: '田馥甄', album: '我的少女时代 电影原声带', durationMs: 265_000 },
      { title: '她来听我的演唱会', artist: '张学友', album: '走过1999', durationMs: 265_000 },
      { title: '大鱼', artist: '周深', album: '大鱼海棠 电影原声带', durationMs: 313_000 },
    ],
  },
  {
    title: '雨天旧唱片',
    description: '雨落在旧唱片上，针尖顺着纹路往回走。',
    platform: 'kugou',
    tracks: [
      { title: '山丘', artist: '李宗盛', album: '山丘', durationMs: 378_000 },
      { title: '恋曲1990', artist: '罗大佑', album: '爱人同志', durationMs: 304_000 },
      { title: '被遗忘的时光', artist: '蔡琴', album: '此情可待', durationMs: 196_000 },
      { title: '当年情', artist: '张国荣', album: '英雄本色 电影原声带', durationMs: 246_000 },
      { title: '女人花', artist: '梅艳芳', album: '女人花', durationMs: 285_000 },
      { title: '海阔天空', artist: 'Beyond', album: '乐与怒', durationMs: 326_000 },
      { title: '一生何求', artist: '陈百强', album: '一生何求', durationMs: 270_000 },
      { title: '一场游戏一场梦', artist: '王杰', album: '一场游戏一场梦', durationMs: 264_000 },
    ],
  },
];
