import { LayoutComponent } from '@gitroom/frontend/components/new-layout/layout.component';
import { ToybacoEmbedReady } from '@gitroom/frontend/components/new-layout/toybaco.embed.ready';
import { toybacoAppOrigin } from '@gitroom/frontend/helpers/toybaco.app.origin';

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <ToybacoEmbedReady appOrigin={toybacoAppOrigin() || ''} />
      <LayoutComponent>{children}</LayoutComponent>
    </>
  );
}
