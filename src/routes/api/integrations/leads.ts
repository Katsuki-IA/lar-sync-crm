import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/integrations/leads")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleReportingRequest } = await import("@/lib/reporting-api.server");
        return handleReportingRequest(request);
      },
    },
  },
});
