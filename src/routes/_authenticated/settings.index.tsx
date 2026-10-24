import { createFileRoute, redirect } from "@tanstack/react-router";

// Rota antiga: a entrada canônica de Configurações é /administracao.
export const Route = createFileRoute("/_authenticated/settings/")({
  beforeLoad: ({ location }) => {
    throw redirect({ href: "/administracao" + location.searchStr });
  },
});
