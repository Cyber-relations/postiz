import React from 'react';

// toybaco_branding_v2: 承認済み原画を使う。認証中も別の簡略ロゴへ切り替えない。
export const LogoTextComponent = () => {
  return (
    <div className="flex items-center gap-[10px]">
      <img
        src="/logo.svg?v=9a0c76c6caed46ff017386e8c9bf33ddba4d0fade4864647563ce24af3445504"
        alt=""
        width="40"
        height="40"
        style={{ width: 40, height: 40, flexShrink: 0, objectFit: 'contain' }}
      />
      <span className="text-[26px] font-[700] tracking-[0.02em]">トイバコ</span>
    </div>
  );
};
