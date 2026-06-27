import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/settings/empreendimentos")({
  beforeLoad: () => { throw redirect({ to: "/settings/users" }); },
});
