import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/settings/hub")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/users" });
  },
});
