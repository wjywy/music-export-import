import { useState } from 'react';

export function NeteaseQrImage({ image, alt, expired }: { image: string; alt: string; expired: boolean }) {
  const [phone, setPhone] = useState(() => window.matchMedia('(pointer: coarse)').matches);
  const qr = <img src={image} alt={alt} />;
  return <div className="netease-qr-image">
    {phone && !expired ? <>
      <ol className="field-hint">
        <li>保存二维码到相册，或展开二维码截图。</li>
        <li>打开网易云音乐的扫一扫，从相册选择这张二维码并确认登录。</li>
        <li>返回渡口，页面会自动检查登录结果。</li>
      </ol>
      <details><summary>显示二维码</summary>{qr}</details>
    </> : qr}
    {!expired ? <div className="panel-actions">
      <a className="btn btn-ghost btn-sm" href={image} download="dukou-netease-qr.png">保存二维码</a>
      <button type="button" className="btn btn-quiet btn-sm" onClick={() => setPhone(value => !value)}>
        {phone ? '用另一台设备扫码' : '用这台手机扫码'}
      </button>
    </div> : null}
  </div>;
}
