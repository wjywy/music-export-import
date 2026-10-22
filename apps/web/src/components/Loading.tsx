export function Loading({ label = '正在读取…' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      <span>{label}</span>
    </div>
  );
}

export function LoadingBlock({ label = '正在读取…' }: { label?: string }) {
  return (
    <div className="loading-block">
      <div className="loading" style={{ justifyContent: 'center' }}>
        <span className="spinner" />
        <span>{label}</span>
      </div>
    </div>
  );
}
