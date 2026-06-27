import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/settings/stages")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/users" });
  },
});
