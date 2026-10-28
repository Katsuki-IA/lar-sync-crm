import { useState } from "react";
import { ArrowDown, BookOpen, ExternalLink, Search, ShieldCheck } from "lucide-react";
import { ConfigHeader, ConfigSection, ConfigStatus } from "@/components/config-presentation";
import { Input } from "@/components/ui/input";
import type { TechnicalDocs } from "@/lib/technical-docs.types";

const searchable = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export function TechnicalDocsContent({ docs }: { docs: TechnicalDocs }) {
  const [search, setSearch] = useState("");
  const term = searchable(search.trim());
  const sections = docs.sections
    .map((section) => ({
      ...section,
      entries: searchable(section.title + " " + section.summary).includes(term)
        ? section.entries
        : section.entries.filter((entry) =>
            searchable(`${entry.title} ${entry.text} ${entry.source ?? ""}`).includes(term),
          ),
    }))
    .filter((section) => section.entries.length > 0);

  return (
    <div className="config-page min-w-0 space-y-6">
      <ConfigHeader
        title="Documentação técnica"
        description="Um guia para entender, operar e dar continuidade ao Katsuki HUB."
        context="Administração global · Acesso exclusivo do super admin"
      />
      <ConfigSection>
        <div className="flex flex-wrap items-center gap-3">
          <BookOpen className="h-5 w-5 text-primary" aria-hidden="true" />
          <ConfigStatus>Revisado em {docs.reviewedAt}</ConfigStatus>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Conteúdo protegido no servidor
          </span>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">{docs.scope}</p>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            aria-label="Buscar na documentação técnica"
            placeholder="Buscar serviço, tabela, integração ou procedimento…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>
        <nav aria-label="Seções da documentação" className="flex flex-wrap gap-2">
          {sections.map((section) => (
            <a
              key={section.id}
              href={`#tecnica-${section.id}`}
              className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              {section.title}
            </a>
          ))}
        </nav>
      </ConfigSection>

      {!term && (
        <section aria-labelledby="technical-maps" className="space-y-4">
          <h2 id="technical-maps" className="text-lg font-semibold">
            Mapas do sistema
          </h2>
          <div className="grid gap-4 xl:grid-cols-3">
            {docs.maps.map((map) => (
              <article key={map.title} className="rounded-xl border border-border bg-card p-5">
                <h3 className="font-semibold">{map.title}</h3>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {map.description}
                </p>
                <ol className="mt-5">
                  {map.steps.map((step, index) => (
                    <li key={step.title}>
                      {index > 0 && (
                        <div className="flex justify-center py-2">
                          <ArrowDown aria-hidden="true" className="h-4 w-4 text-primary" />
                        </div>
                      )}
                      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                        <p className="text-sm font-medium">
                          <span className="mr-2 text-primary">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          {step.title}
                        </p>
                        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                          {step.text}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </div>
        </section>
      )}

      <p role="status" className="text-xs text-muted-foreground">
        {term
          ? `${sections.length} seções encontradas`
          : `${docs.sections.length} seções · Links, arquitetura e procedimentos`}
      </p>
      {sections.length === 0 && (
        <ConfigSection>
          <p className="text-sm text-muted-foreground">
            Nenhum resultado para “{search}”. Tente buscar por Supabase, WhatsApp, banco ou
            publicação.
          </p>
        </ConfigSection>
      )}
      {sections.map((section, index) => (
        <div key={section.id} id={`tecnica-${section.id}`} className="scroll-mt-6">
          <ConfigSection>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-widest text-primary">
                Referência {String(index + 1).padStart(2, "0")}
              </p>
              <h2 className="text-lg font-semibold">{section.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{section.summary}</p>
            </div>
            <div className="divide-y divide-border">
              {section.entries.map((entry) => (
                <article key={entry.title} className="py-4 first:pt-0 last:pb-0">
                  <h3 className="text-sm font-semibold">{entry.title}</h3>
                  <p className="mt-2 whitespace-pre-line break-words text-sm leading-7 text-muted-foreground">
                    {entry.text}
                  </p>
                  {entry.href && (
                    <a
                      href={entry.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex max-w-full items-center gap-2 break-all text-sm text-primary underline underline-offset-4"
                    >
                      {entry.href}
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="sr-only"> (abre em nova aba)</span>
                    </a>
                  )}
                  {entry.source && (
                    <p className="mt-2 break-words text-xs text-muted-foreground">
                      Referência: {entry.source}
                    </p>
                  )}
                </article>
              ))}
            </div>
          </ConfigSection>
        </div>
      ))}
    </div>
  );
}
