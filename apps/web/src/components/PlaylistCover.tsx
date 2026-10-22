import type { CSSProperties } from 'react';
import { PLATFORM_INFO } from '../lib/platforms';
import type { Platform } from '../lib/types';

const TINTS = ['--cover-a', '--cover-b', '--cover-c', '--cover-d'];

function tintFor(title: string): string {
  let hash = 0;
  for (let index = 0; index < title.length; index += 1) {
    hash = (hash * 31 + title.charCodeAt(index)) % 997;
  }
  return TINTS[hash % TINTS.length];
}

interface Props {
  title: string;
  coverUrl?: string | null;
  platform?: Platform | null;
  count?: number | null;
  size?: 'card' | 'lg' | 'sm';
  className?: string;
}

export function PlaylistCover({
  title,
  coverUrl,
  platform,
  count,
  size = 'card',
  className = '',
}: Props) {
  const style = { '--tint': `var(${tintFor(title)})` } as CSSProperties;
  const sizeClass = size === 'lg' ? ' cover--lg' : size === 'sm' ? ' cover--sm' : '';

  if (coverUrl) {
    return (
      <div className={`cover${sizeClass} ${className}`.trim()} style={style}>
        <img className="cover-img" src={coverUrl} alt="" loading="lazy" />
      </div>
    );
  }

  const glyph = title.trim().slice(0, 1) || '渡';
  return (
    <div className={`cover${sizeClass} ${className}`.trim()} style={style} aria-hidden="true">
      <div className="cover-top">
        <span>Side A</span>
        <span>{platform ? PLATFORM_INFO[platform].short : 'Dukou'}</span>
      </div>
      <span className="cover-glyph">{glyph}</span>
      <div className="cover-bottom">
        <span>{count != null ? `${count} 首` : ''}</span>
        <span>渡口</span>
      </div>
    </div>
  );
}
