'use client';

// toybaco_app_icon_ivory: メイン画面・OAuth認可画面も共通の承認済みアイコンを使う。
export const Logo = () => {
  return (
    <img
      src="/logo.svg?v=9a0c76c6caed46ff017386e8c9bf33ddba4d0fade4864647563ce24af3445504"
      alt="トイバコ"
      width="60"
      height="60"
      className="mt-[8px] min-w-[60px] min-h-[60px]"
      style={{ width: 60, height: 60, flexShrink: 0, objectFit: 'contain' }}
    />
  );
};
