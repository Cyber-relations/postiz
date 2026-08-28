import { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'トイバコ - AI アシスタント',
  description: '',
};

export default async function Page() {
  return redirect('/agents/new');
}
