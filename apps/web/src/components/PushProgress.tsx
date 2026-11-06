import type { PushProgress as Progress } from '../lib/types';

const labels: Record<Progress['stage'], string> = {
  preparing: '正在准备迁移', matching: '正在匹配歌曲', resolving: '正在查找目标歌曲',
  creating: '正在创建歌单', writing: '正在写入歌曲', verifying: '正在核对歌单', done: '迁移处理完成',
};

export function PushProgress({ progress, failed = false, awaitingVerification = false }:
  { progress: Progress; failed?: boolean; awaitingVerification?: boolean }) {
  const percent = Math.min(100, Math.max(0, progress.percent));
  const countable = ['matching', 'resolving', 'writing', 'verifying'].includes(progress.stage);
  const label = awaitingVerification ? '已提交，待核对' : failed ? '迁移未完成' : labels[progress.stage];
  const count = countable && progress.total > 0 && !awaitingVerification ? `${progress.completed} / ${progress.total} 首` : '';
  return (
    <div className={`push-progress${failed ? ' push-progress--failed' : ''}`}>
      <div className="push-progress-head" aria-live="polite">
        <span>{label}</span>
        <span className="push-progress-value">{percent}%</span>
      </div>
      <div className="push-progress-track" role="progressbar" aria-label="迁移进度"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${label} ${count}`}>
        <span style={{ transform: `scaleX(${percent / 100})` }} />
      </div>
      {awaitingVerification ? <p className="push-progress-count">请打开目标歌单核对结果</p>
        : count ? <p className="push-progress-count">已处理 {count}</p> : null}
    </div>
  );
}
