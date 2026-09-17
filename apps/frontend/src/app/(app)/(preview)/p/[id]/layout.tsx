import { ReactNode } from 'react';
import { PreviewWrapper } from '@gitroom/frontend/components/preview/preview.wrapper';
import { cookies } from 'next/headers';
import styles from './preview.module.scss';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const theme = (await cookies()).get('mode')?.value === 'dark' ? 'dark' : 'light';
  return (
    <div className={styles.preview} data-toybaco-shared-preview="" data-theme={theme}>
      <PreviewWrapper>{children}</PreviewWrapper>
    </div>
  );
}
