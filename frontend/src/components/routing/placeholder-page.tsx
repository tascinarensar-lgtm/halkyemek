import { ReactNode } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer } from "@/components/ui/page-container";
import { SectionHeader } from "@/components/ui/section-header";

export function PlaceholderPage({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return (
    <PageContainer>
      <SectionHeader title={title} description={description} />
      {children ?? <EmptyState title="İskelet hazır" description="Bu sayfanın veri entegrasyonu foundation üzerine eklenecek." />}
    </PageContainer>
  );
}
