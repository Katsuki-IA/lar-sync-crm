import type { ReactNode } from "react";

type LegalPageLayoutProps = {
  title: string;
  description: string;
  updatedAt: string;
  children: ReactNode;
};

export function LegalPageLayout({ title, description, updatedAt, children }: LegalPageLayoutProps) {
  return (
    <div className="min-h-screen bg-[#FFFCF8] text-foreground">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-5 py-5 sm:px-8">
          <a href="https://katsuki.com.br" aria-label="Ir para o site da Katsuki">
            <img src="/katsuki-logo.svg" alt="Katsuki" className="h-12 w-auto object-contain" />
          </a>
          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            Hub Katsuki
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl px-5 py-12 sm:px-8 sm:py-16">
        <div className="mb-10 border-b border-border pb-8">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-primary">
            Documento legal
          </p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">{description}</p>
          <p className="mt-4 text-sm text-muted-foreground">Última atualização: {updatedAt}</p>
        </div>

        <article className="space-y-9 leading-7 text-muted-foreground [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground [&_li]:pl-1 [&_p+p]:mt-3 [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6">
          {children}
        </article>
      </main>

      <footer className="border-t border-border bg-white">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-5 py-7 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span>© {new Date().getFullYear()} Katsuki. Todos os direitos reservados.</span>
          <nav className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Documentos legais">
            <a href="/politica-de-privacidade" className="hover:text-foreground">
              Política de Privacidade
            </a>
            <a href="/termos-de-uso" className="hover:text-foreground">
              Termos de Uso
            </a>
            <a href="/privacidade/exclusao-de-dados" className="hover:text-foreground">
              Exclusão de Dados
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
