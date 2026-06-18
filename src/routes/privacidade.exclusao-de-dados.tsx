import { createFileRoute } from "@tanstack/react-router";
import katsukiLogo from "@/assets/katsuki-logo.jpg.asset.json";

export const Route = createFileRoute("/privacidade/exclusao-de-dados")({
  head: () => ({
    meta: [
      { title: "Solicitação de Exclusão de Dados — Katsuki" },
      { name: "description", content: "Solicite a exclusão dos seus dados coletados via integração com Facebook/Meta." },
    ],
  }),
  component: ExclusaoDeDadosPage,
});

function ExclusaoDeDadosPage() {
  return (
    <div className="flex min-h-screen flex-col items-center bg-background px-4 py-12 text-foreground">
      <div className="w-full max-w-2xl">
        <div className="mb-8 flex items-center gap-3">
          <div className="h-10 w-10 overflow-hidden rounded-xl ring-1 ring-white/10 shadow-sm">
            <img src={katsukiLogo.url} alt="Katsuki" className="h-full w-full object-cover" />
          </div>
          <span className="text-lg font-semibold tracking-[0.15em]">KATSUKI</span>
        </div>

        <h1 className="mb-6 text-3xl font-bold tracking-tight">Solicitação de Exclusão de Dados</h1>

        <div className="space-y-6 text-muted-foreground leading-relaxed">
          <p>
            Você pode solicitar a exclusão dos seus dados pessoais que foram coletados através das
            nossas integrações com <strong>Facebook/Meta Lead Ads</strong>.
          </p>

          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-foreground">Como solicitar a exclusão</h2>
            <ol className="list-decimal space-y-3 pl-5">
              <li>
                Envie um email para{" "}
                <a
                  href="mailto:fatcho@fg1.com.br?subject=Exclusão de Dados"
                  className="text-primary underline underline-offset-2 hover:text-primary/80"
                >
                  fatcho@fg1.com.br
                </a>
              </li>
              <li>
                No <strong>assunto</strong> do email, escreva: <em>Exclusão de Dados</em>
              </li>
              <li>
                No corpo da mensagem, informe:
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>Seu <strong>nome completo</strong></li>
                  <li>O <strong>email</strong> cadastrado no formulário</li>
                </ul>
              </li>
            </ol>
          </div>

          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <h2 className="mb-2 text-lg font-semibold text-foreground">Prazo de atendimento</h2>
            <p>
              Processamos e respondemos às solicitações em até{" "}
              <strong className="text-foreground">72 horas úteis</strong>.
            </p>
          </div>

          <p className="text-sm">
            Após a confirmação, seus dados serão removidos dos nossos sistemas e das integrações
            com o Meta dentro do prazo estabelecido.
          </p>
        </div>
      </div>
    </div>
  );
}
