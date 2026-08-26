import { createFileRoute } from "@tanstack/react-router";
import { Copy, ExternalLink, FileText } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/admin/paginas-legais")({
  component: LegalPagesAdminPage,
});

const LEGAL_PAGES = [
  {
    title: "Política de Privacidade",
    description:
      "Tratamento de dados pessoais, LGPD, cookies, integrações e direitos dos titulares.",
    url: "https://hub.katsuki.com.br/politica-de-privacidade",
  },
  {
    title: "Termos de Uso",
    description: "Condições públicas de acesso e utilização do Hub Katsuki.",
    url: "https://hub.katsuki.com.br/termos-de-uso",
  },
] as const;

function LegalPagesAdminPage() {
  async function copyUrl(url: string) {
    await navigator.clipboard.writeText(url);
    toast.success("Endereço copiado");
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Páginas legais</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Endereços públicos para integrações, cadastro e aprovação de aplicativos.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {LEGAL_PAGES.map((page) => (
          <Card key={page.url} className="rounded-2xl">
            <CardHeader className="pb-3">
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <FileText className="h-5 w-5" />
              </div>
              <CardTitle className="text-lg">{page.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm leading-6 text-muted-foreground">{page.description}</p>
              <div className="rounded-lg border bg-muted/40 px-3 py-2 font-mono text-xs text-foreground break-all">
                {page.url}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => copyUrl(page.url)}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copiar endereço
                </Button>
                <Button asChild type="button" size="sm">
                  <a href={page.url} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Abrir página
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
