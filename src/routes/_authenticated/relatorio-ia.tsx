import { createFileRoute, redirect } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";

const searchSchema = z.object({
  inicio: fallback(z.string(), "").default(""),
  fim: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/_authenticated/relatorio-ia")({
  validateSearch: zodValidator(searchSchema),
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/relatorios",
      search: { aba: "raio-x", inicio: search.inicio, fim: search.fim },
      replace: true,
    });
  },
});
