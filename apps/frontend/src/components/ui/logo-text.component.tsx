import React from 'react';

// toybaco_branding_v2: 元の製品ロゴをトイバコへ置き換える。
export const LogoTextComponent = () => {
  return (
    <div className="flex items-center gap-[10px]">
      <svg width="40" height="40" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
<g transform="translate(15.360000000000014,15.360000000000014) scale(0.94)">
  <g fill="#183D66">
    <path d="M92,310 L249,310 L249,458 L114,436 Z"/>
    <path d="M263,310 L420,310 L398,436 L263,458 Z"/>
    <path d="M92,310 L0,218 L44,174 L136,266 Z"/>
    <path d="M420,310 L512,218 L468,174 L376,266 Z"/>
    <path d="M140,310 L198,310 L184,262 L154,267 Z"/>
    <path d="M314,310 L372,310 L358,267 L328,262 Z"/>
  </g>
  <rect x="166" y="60" width="180" height="134" rx="44" fill="#03B952"/>
  <path d="M236,188 L256,230 L276,188 Z" fill="#03B952"/>
  <circle cx="214" cy="127" r="13" fill="#FFFFFF"/>
  <circle cx="256" cy="127" r="13" fill="#FFFFFF"/>
  <circle cx="298" cy="127" r="13" fill="#FFFFFF"/>
</g>
      </svg>
      <span className="text-[26px] font-[700] tracking-[0.02em]">トイバコ</span>
    </div>
  );
};
