'use client';

import { FC } from 'react';

const Spinner: FC<{
  type?: string;
  color?: string;
  width?: number;
  height?: number;
  label?: string;
}> = ({ color = 'var(--toybaco-muted, #66758a)', width = 28, height = 28, label = '読み込み中' }) => {
  const requestedSize = Math.min(width, height);
  const size = Number.isFinite(requestedSize) ? Math.max(16, Math.min(28, requestedSize)) : 28;
  return (
    <div
      data-toybaco-spinner=""
      role="status"
      aria-label={label}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        boxSizing: 'border-box',
        border: `${size < 24 ? 2 : 3}px solid var(--toybaco-hairline, #dce2e8)`,
        borderTopColor: color,
        borderRadius: '50%',
        animation: 'toybaco-spin 1s linear infinite',
      }}
    />
  );
};

export { Spinner as default };

export const LoadingComponent: FC<{ width?: number; height?: number }> = () => (
  <div data-toybaco-page-loading="" className="flex min-h-[160px] flex-1 items-center justify-center p-[24px]">
    <Spinner />
  </div>
);

export const LoadingSurface: FC<{ label: string; description?: string }> = ({ label, description }) => (
  <div data-toybaco-loading-surface="" className="flex min-h-[160px] flex-1 flex-col items-center justify-center gap-[16px] p-[24px] text-center"
    style={{ color: 'var(--toybaco-ink, var(--color-text, #24303f))', backgroundColor: 'var(--toybaco-surface, var(--new-bgColorInner, #fcfbf8))' }}>
    <Spinner label={label} />
    <p aria-hidden="true" className="text-[16px] leading-6">{label}</p>
    {description && <p className="max-w-[360px] text-[14px] leading-6" style={{ color: 'var(--toybaco-muted, #66758a)' }}>{description}</p>}
  </div>
);
