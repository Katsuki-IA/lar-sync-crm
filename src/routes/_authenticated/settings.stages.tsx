import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/settings/stages")({
  beforeLoad: ({ location }) => {
    throw redirect({ href: "/configuracoes" + location.searchStr });
  },
});
