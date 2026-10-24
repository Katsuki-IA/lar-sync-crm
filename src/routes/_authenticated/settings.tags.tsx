import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/settings/tags")({
  beforeLoad: ({ location }) => {
    throw redirect({ href: "/settings/users" + location.searchStr });
  },
});
