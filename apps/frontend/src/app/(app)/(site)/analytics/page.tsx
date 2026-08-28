export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { PlatformAnalytics } from '@gitroom/frontend/components/platform-analytics/platform.analytics';
export const metadata: Metadata = {
  title: 'トイバコ 投稿分析',
  description: '',
};
export default async function Index() {
  return <PlatformAnalytics />;
}
