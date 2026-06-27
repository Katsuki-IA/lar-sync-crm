import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/settings/tags")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/users" });
  },
});
