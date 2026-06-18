import { supabase } from "@/integrations/supabase/client";

export type MetaConnectionStatus = {
  id: string;
  user_name: string | null;
  user_id_meta: string;
  connected_at: string | null;
  active: boolean | null;
};

export type MetaFormStatus = {
  id: string;
  form_id: string;
  form_name: string | null;
  page_id: string;
  page_name: string | null;
  leads_count: number | null;
  active: boolean | null;
};

export type MetaIntegrationStatus = {
  connection: MetaConnectionStatus | null;
  forms: MetaFormStatus[];
};

export type MetaFormsSyncResult = {
  pagesCount: number;
  formsCount: number;
  pages: Array<{
    pageId: string;
    pageName: string | null;
    formsCount: number;
    hasAccessToken: boolean;
  }>;
  errors: Array<{
    pageId: string;
    pageName: string | null;
    message: string;
  }>;
};

export type MetaOAuthExchangeResult = {
  ok: true;
  connection: MetaConnectionStatus;
  sync: MetaFormsSyncResult;
};

async function invokeMetaFunction<T>(name: string, body?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, {
    body: body ?? {},
  });

  if (error) {
    throw new Error(error.message || `Falha ao executar ${name}`);
  }

  if (!data) {
    throw new Error(`Resposta vazia de ${name}`);
  }

  return data;
}

export async function createMetaOAuthUrl() {
  return invokeMetaFunction<{ url: string }>("meta-oauth-start");
}

export async function exchangeMetaCode(data: { code: string; state: string }) {
  return invokeMetaFunction<MetaOAuthExchangeResult>("meta-oauth-exchange", data);
}

export async function getMetaIntegrationStatus() {
  return invokeMetaFunction<MetaIntegrationStatus>("meta-integration-status");
}

export async function syncMetaForms() {
  return invokeMetaFunction<MetaFormsSyncResult>("meta-forms-sync");
}

export async function disconnectMetaConnection() {
  return invokeMetaFunction<{ ok: true }>("meta-disconnect");
}
