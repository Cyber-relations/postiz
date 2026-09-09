import { createContext, FC, ReactNode, useContext } from 'react';
import { toybacoPostingFailure } from '@gitroom/helpers/utils/posts.list.minify';
import { Post } from '@prisma/client';
const ExistingDataContext = createContext({
  integration: '',
  group: undefined as undefined | string,
  posts: [] as (Post & { toybacoFailureCode?: unknown })[],
  settings: {} as any,
});
export const ExistingDataContextProvider: FC<{
  children: ReactNode;
  value: any;
}> = ({ children, value }) => {
  return (
    <ExistingDataContext.Provider value={value}>
      {children}
    </ExistingDataContext.Provider>
  );
};
export const useExistingData = () => useContext(ExistingDataContext);

export const ToybacoPostingFailureNotice: FC = () => {
  const { posts } = useExistingData();
  const failure = toybacoPostingFailure(posts.find((post) => post.state === 'ERROR'));
  if (!failure) return null;
  return (
    <section data-toybaco-posting-failure="" role="status" aria-label="公開に失敗した理由と対処" style={{ padding: '12px 14px', border: '1px solid #E6B5AF', borderRadius: 10, background: '#FFF5F3', color: '#663D36', fontSize: 13, lineHeight: 1.7, overflowWrap: 'anywhere', flexShrink: 0 }}>
      <strong>公開に失敗した理由</strong>
      <p>{failure.reason}</p>
      <p style={{ marginTop: 6 }}>{failure.nextAction}</p>
      <p style={{ marginTop: 6 }}>保存済みの本文とメディアは、この画面で確認できます。</p>
    </section>
  );
};
