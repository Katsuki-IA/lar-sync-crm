import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultPreload: "intent",
    // Keep showing the previous route until the next one is ready,
    // avoiding the black flash between navigations.
    defaultPendingMs: 1000,
    defaultPendingMinMs: 0,
  });

  return router;
};
