import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CompanyTags, OpportunityTags } from "../src/hml/commercial-tags";
import "../src/styles.css";
import "../src/hml/visual.css";
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={qc}><main className="config-page mx-auto max-w-5xl space-y-6 p-6"><p className="text-xs text-muted-foreground">PRÉVIA LOCAL · DADOS FICTÍCIOS</p><h1 className="text-2xl font-semibold">Tags</h1><CompanyTags companyId={1}/><OpportunityTags companyId={1} opportunityId="preview"/></main></QueryClientProvider>);
