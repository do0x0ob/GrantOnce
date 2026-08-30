"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";

import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DOCS_ARTICLES,
  DOCS_CATEGORIES,
  findDocs,
  type DocsArticle,
} from "@/lib/docs";
import { cn } from "@/lib/utils";

type AssistantSource = Pick<DocsArticle, "id" | "title" | "summary">;
type AssistantMessage = {
  id: string;
  role: "user" | "agent";
  text: string;
  sources?: AssistantSource[];
};

const QUICK_QUESTIONS = [
  "我是開發者，要怎麼串接？",
  "政府部門可以怎麼開始試辦？",
  "使用者的資料會交給誰？",
];

function updateDocsUrl(articleId: string, query?: string) {
  const params = new URLSearchParams(window.location.search);
  params.set("article", articleId);
  if (query?.trim()) params.set("q", query.trim());
  else params.delete("q");
  window.history.replaceState(null, "", `/docs?${params.toString()}`);
}

function scrollDocsToTop() {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
}

function DocsAssistant({ onOpenArticle }: { onOpenArticle: (id: string) => void }) {
  const [question, setQuestion] = useState("");
  const [lastAttempt, setLastAttempt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([
    {
      id: "welcome",
      role: "agent",
      text: "問我 GrantOnce 的使用流程、串接方式或政府試辦。我只查這份文件，不會操作任何授權。",
    },
  ]);

  async function ask(raw: string) {
    const text = raw.trim();
    if (!text || busy) return;
    const userMessage: AssistantMessage = { id: `u:${Date.now()}`, role: "user", text };
    setMessages((current) => [...current, userMessage]);
    setLastAttempt(text);
    setQuestion("");
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/docs/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      const data = (await response.json()) as {
        answer?: string;
        sources?: AssistantSource[];
        error?: string;
      };
      if (!response.ok || !data.answer) throw new Error(data.error ?? "文件查詢失敗");
      setMessages((current) => [
        ...current,
        {
          id: `a:${Date.now()}`,
          role: "agent",
          text: data.answer!,
          sources: data.sources ?? [],
        },
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "文件查詢失敗");
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(question);
  }

  return (
    <aside className="rounded-[28px] bg-popover p-4 shadow-[0_1px_0_rgba(26,24,20,0.05)] xl:sticky xl:top-24">
      <div className="flex items-start justify-between gap-4 px-1 pb-4">
        <div>
          <p className="text-[12px] font-medium tracking-[0.08em] text-muted-foreground">文件助理</p>
          <h2 className="mt-1 text-[17px] font-medium tracking-tight text-foreground">直接問這份文件</h2>
        </div>
        <span className="rounded-full bg-[var(--wash-sage)] px-2.5 py-1 text-[11px] font-medium text-[var(--sage)]">
          只讀
        </span>
      </div>

      <div
        className="flex max-h-[28rem] min-h-64 flex-col gap-4 overflow-y-auto rounded-[22px] bg-background/70 p-3"
        aria-live="polite"
        aria-busy={busy}
      >
        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              "max-w-[92%] text-[13px] leading-6",
              message.role === "user"
                ? "self-end rounded-[18px] bg-primary px-3.5 py-2 text-primary-foreground"
                : "self-start text-foreground",
            )}
          >
            <p>{message.text}</p>
            {message.sources?.length ? (
              <div className="mt-3 space-y-2">
                {message.sources.map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => onOpenArticle(source.id)}
                    className="block min-h-10 w-full rounded-[14px] bg-popover px-3 py-2 text-left text-[12px] leading-5 text-foreground transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="font-medium">{source.title}</span>
                    <span className="ml-1 text-muted-foreground">→</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        {busy ? (
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <span className="inline-flex gap-1" aria-hidden="true">
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s] motion-reduce:animate-none" />
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s] motion-reduce:animate-none" />
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground motion-reduce:animate-none" />
            </span>
            正在查文件…
          </div>
        ) : null}
      </div>

      {error ? (
        <div id="docs-agent-error" className="mt-3 rounded-[16px] bg-destructive/10 px-3 py-2 text-[12px] leading-5 text-destructive">
          <p>{error}</p>
          <button
            type="button"
            className="mt-1 min-h-10 font-medium underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => void ask(lastAttempt)}
          >
            再試一次
          </button>
        </div>
      ) : null}

      <form onSubmit={submit} className="mt-3 space-y-2">
        <label htmlFor="docs-agent-question" className="sr-only">
          詢問 GrantOnce 文件
        </label>
        <textarea
          id="docs-agent-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="例如：政府部門要怎麼開始？"
          maxLength={300}
          rows={3}
          className="w-full resize-none rounded-[20px] border-0 bg-background px-4 py-3 text-[14px] leading-6 text-foreground shadow-[0_1px_0_rgba(26,24,20,0.04)] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          aria-describedby={error ? "docs-agent-error" : undefined}
          aria-invalid={error ? true : undefined}
        />
        <Button type="submit" size="lg" className="w-full" disabled={busy || !question.trim()}>
          {busy ? "查詢中" : "查詢文件"}
        </Button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2">
        {QUICK_QUESTIONS.map((item) => (
          <button
            key={item}
            type="button"
            disabled={busy}
            onClick={() => void ask(item)}
            className="min-h-10 rounded-full bg-secondary px-3 text-left text-[11px] leading-4 text-secondary-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {item}
          </button>
        ))}
      </div>
    </aside>
  );
}

function ArticleBody({ article }: { article: DocsArticle }) {
  return (
    <article className="min-w-0">
      <div className="border-b border-border pb-8">
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
          <span>{article.eyebrow}</span>
          <span aria-hidden="true">·</span>
          <span>{article.readTime}</span>
        </div>
        <h1 className="mt-4 max-w-[42rem] text-3xl font-medium leading-tight tracking-[-0.035em] text-foreground md:text-4xl">
          {article.title}
        </h1>
        <p className="mt-4 max-w-[44rem] text-[17px] leading-8 text-muted-foreground">
          {article.summary}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {article.audiences.map((audience) => (
            <span key={audience} className="rounded-full bg-secondary px-3 py-1.5 text-[12px] text-secondary-foreground">
              {audience}
            </span>
          ))}
        </div>
      </div>

      <nav aria-label="本頁段落" className="my-8 rounded-[22px] bg-secondary/70 p-4">
        <p className="text-[12px] font-medium tracking-[0.08em] text-muted-foreground">本頁內容</p>
        <div className="mt-2 grid gap-1 sm:grid-cols-2">
          {article.sections.map((section, index) => (
            <a
              key={section.title}
              href={`#section-${index}`}
              className="flex min-h-10 items-center rounded-[12px] px-2 text-[13px] text-foreground hover:bg-background focus-visible:ring-2 focus-visible:ring-ring"
            >
              {section.title}
            </a>
          ))}
        </div>
      </nav>

      <div className="space-y-12 pb-20">
        {article.sections.map((section, index) => (
          <section key={section.title} id={`section-${index}`} className="scroll-mt-24">
            <p className="font-mono text-[12px] text-muted-foreground">{String(index + 1).padStart(2, "0")}</p>
            <h2 className="mt-2 text-[23px] font-medium tracking-tight text-foreground">{section.title}</h2>
            <div className="mt-4 max-w-prose space-y-4 text-[15px] leading-7 text-muted-foreground">
              {(section.paragraphs ?? []).map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
            {section.bullets?.length ? (
              <ul className="mt-5 max-w-prose space-y-3">
                {section.bullets.map((bullet) => (
                  <li key={bullet} className="flex gap-3 text-[15px] leading-7 text-foreground">
                    <span className="mt-3 size-1.5 shrink-0 rounded-full bg-[var(--orchid)]" aria-hidden="true" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {section.code ? (
              <div className="mt-5 overflow-x-auto rounded-[20px] bg-primary p-5 text-primary-foreground">
                <pre className="font-mono text-[12px] leading-6"><code>{section.code}</code></pre>
              </div>
            ) : null}
            {section.note ? (
              <div className="mt-5 max-w-prose rounded-[20px] bg-[var(--wash-sage)] p-4 text-[13px] leading-6 text-[var(--sage)]">
                {section.note}
              </div>
            ) : null}
          </section>
        ))}
      </div>
    </article>
  );
}

export function DocsWorkspace({ initialArticleId, initialQuery }: { initialArticleId: string; initialQuery: string }) {
  const initial = DOCS_ARTICLES.find((article) => article.id === initialArticleId) ?? DOCS_ARTICLES[0];
  const [articleId, setArticleId] = useState(initial.id);
  const [searchDraft, setSearchDraft] = useState(initialQuery);
  const [searchQuery, setSearchQuery] = useState(initialQuery);

  const article = DOCS_ARTICLES.find((entry) => entry.id === articleId) ?? DOCS_ARTICLES[0];
  const results = useMemo(() => findDocs(searchQuery), [searchQuery]);

  function openArticle(id: string) {
    setArticleId(id);
    updateDocsUrl(id, searchQuery);
    scrollDocsToTop();
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = searchDraft.trim();
    const matches = findDocs(next);
    setSearchQuery(next);
    if (matches[0]) {
      setArticleId(matches[0].id);
      updateDocsUrl(matches[0].id, next);
    }
  }

  function clearSearch() {
    setSearchDraft("");
    setSearchQuery("");
    updateDocsUrl(articleId);
  }

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[90rem] items-center justify-between gap-4 px-4 md:px-6 lg:px-8">
          <div className="flex items-center gap-5">
            <Link href="/" className="flex min-h-10 items-center gap-3 rounded-full focus-visible:ring-2 focus-visible:ring-ring">
              <BrandMark className="size-7" />
              <span className="text-[15px] font-medium tracking-tight">GrantOnce</span>
            </Link>
            <span className="hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
            <span className="hidden text-[13px] text-muted-foreground sm:inline">文件中心</span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="inline-flex min-h-10 items-center rounded-full px-4 text-[13px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              回到演示
            </Link>
            <a
              href="https://github.com/do0x0ob/GrantOnce"
              target="_blank"
              rel="noreferrer"
              className="hidden min-h-10 items-center rounded-full bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
            >
              GitHub ↗
            </a>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[90rem] px-4 py-6 md:px-6 lg:px-8">
        <div className="mb-6 lg:hidden">
          <label htmlFor="mobile-doc-article" className="mb-2 block text-[12px] font-medium text-muted-foreground">
            選擇文件
          </label>
          <select
            id="mobile-doc-article"
            value={article.id}
            onChange={(event) => openArticle(event.target.value)}
            className="h-12 w-full rounded-full border-0 bg-popover px-4 text-[14px] text-foreground shadow-[0_1px_0_rgba(26,24,20,0.04)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {DOCS_CATEGORIES.map((category) => (
              <optgroup key={category} label={category}>
                {DOCS_ARTICLES.filter((item) => item.category === category).map((item) => (
                  <option key={item.id} value={item.id}>{item.title}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="grid items-start gap-8 lg:grid-cols-[16rem_minmax(0,1fr)] xl:grid-cols-[16rem_minmax(0,1fr)_20rem]">
          <aside className="hidden lg:sticky lg:top-24 lg:block">
            <form onSubmit={search} className="space-y-2">
              <label htmlFor="docs-search" className="text-[12px] font-medium text-muted-foreground">搜尋文件</label>
              <Input
                id="docs-search"
                type="search"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="輸入關鍵字"
                autoComplete="off"
                className="h-11 bg-popover text-[13px]"
              />
              <Button type="submit" variant="secondary" size="lg" className="w-full">查詢</Button>
            </form>

            {searchQuery ? (
              <div className="mt-5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[12px] text-muted-foreground">{results.length} 筆結果</p>
                  <button type="button" onClick={clearSearch} className="min-h-10 px-2 text-[12px] text-muted-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring">清除</button>
                </div>
                {results.length ? (
                  <div className="mt-1 space-y-1">
                    {results.map((item) => (
                      <button key={item.id} type="button" onClick={() => openArticle(item.id)} className="min-h-10 w-full rounded-[12px] px-2 py-2 text-left text-[13px] leading-5 text-foreground hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring">{item.title}</button>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 rounded-[16px] bg-secondary p-3 text-[12px] leading-5 text-muted-foreground">
                    沒找到對應文件。試試「串接」、「政府」或「隱私」。
                  </div>
                )}
              </div>
            ) : (
              <nav aria-label="文件分類" className="mt-8 space-y-7">
                {DOCS_CATEGORIES.map((category) => (
                  <div key={category}>
                    <p className="px-2 text-[11px] font-medium tracking-[0.08em] text-muted-foreground">{category}</p>
                    <div className="mt-2 space-y-1">
                      {DOCS_ARTICLES.filter((item) => item.category === category).map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => openArticle(item.id)}
                          aria-current={item.id === article.id ? "page" : undefined}
                          className={cn(
                            "min-h-10 w-full rounded-[14px] px-3 py-2 text-left text-[13px] leading-5 transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                            item.id === article.id
                              ? "bg-popover font-medium text-foreground"
                              : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                          )}
                        >
                          {item.title}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </nav>
            )}
          </aside>

          <ArticleBody article={article} />

          <div className="lg:col-start-2 xl:col-start-auto">
            <DocsAssistant onOpenArticle={openArticle} />
          </div>
        </div>
      </div>
    </div>
  );
}
