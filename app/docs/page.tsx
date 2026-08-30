import type { Metadata } from "next";

import { DocsWorkspace } from "@/components/docs-workspace";
import { DOCS_ARTICLES } from "@/lib/docs";

export const metadata: Metadata = {
  title: "GrantOnce 文件中心",
  description: "了解 GrantOnce 的使用流程、開發者串接、政府試辦與安全模型。",
};

export default async function DocsPage({
  searchParams,
}: {
  searchParams: Promise<{ article?: string | string[]; q?: string | string[] }>;
}) {
  const query = await searchParams;
  const requested = typeof query.article === "string" ? query.article : "overview";
  const initialArticleId = DOCS_ARTICLES.some((article) => article.id === requested)
    ? requested
    : "overview";
  const initialQuery = typeof query.q === "string" ? query.q : "";

  return <DocsWorkspace initialArticleId={initialArticleId} initialQuery={initialQuery} />;
}
