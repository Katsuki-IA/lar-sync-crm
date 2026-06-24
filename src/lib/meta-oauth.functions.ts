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
  id_empreendimento: number | null;
  id_funnel: number | null;
  mapped_fields_count?: number;
};

export type MetaIntegrationStatus = {
  connection: MetaConnectionStatus | null;
  forms: MetaFormStatus[];
  summary: {
    processed: number;
    last_event_at: string | null;
  };
};

export type MetaFormsSyncResult = {
  pagesCount: number;
  formsCount: number;
  pages: Array<{
    pageId: string;
    pageName: string | null;
    formsCount: number;
    hasAccessToken: boolean;
    webhookSubscribed: boolean;
    source: string | null;
  }>;
  errors: Array<{
    pageId: string;
    pageName: string | null;
    message: string;
  }>;
  sources: Array<{
    source: string;
    count: number;
    error: string | null;
  }>;
};

export type MetaOAuthExchangeResult = {
  ok: true;
  connection: MetaConnectionStatus;
  sync: MetaFormsSyncResult;
};

export type MetaFormField = {
  key: string;
  label: string;
  type: string | null;
};

export type MetaFormFieldsResult = {
  form: {
    form_id: string;
    form_name: string | null;
    page_id: string;
    page_name: string | null;
    id_empreendimento: number | null;
    id_funnel: number | null;
  };
  empreendimentos: Array<{
    id: number;
    nome: string;
  }>;
  funnels: Array<{
    id: number;
    nome: string;
    is_default: boolean;
  }>;
  fields: MetaFormField[];
  mapping: Record<string, string>;
};

export type MetaSaveFieldMappingInput = {
  formId: string;
  empreendimentoId: number;
  funnelId: number;
  mapping: Array<{
    metaFieldKey: string;
    crmField: string;
  }>;
};

export type MetaTestLeadInput = {
  formId: string;
  fieldValues: Record<string, string>;
};

export type MetaTestLeadResult = {
  ok: true;
  leadId: number;
  metaLeadId: string;
};

async function getFunctionErrorMessage(error: unknown, fallback: string) {
  const context = (error as { context?: unknown } | null)?.context;

  if (context instanceof Response) {
    try {
      const payload = await context.clone().json();
      if (typeof payload?.error === "string" && payload.error.trim()) {
        return payload.error;
      }
      if (typeof payload?.message === "string" && payload.message.trim()) {
        return payload.message;
      }
    } catch {
      try {
        const text = await context.clone().text();
        if (text.trim()) return text;
      } catch {
        // Keep the original SDK message below.
      }
    }
  }

  return error instanceof Error && error.message ? error.message : fallback;
}

async function invokeMetaFunction<T>(name: string, body?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, {
    body: body ?? {},
  });

  if (error) {
    throw new Error(await getFunctionErrorMessage(error, `Falha ao executar ${name}`));
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

export async function getMetaFormFields(data: { formId: string }) {
  return invokeMetaFunction<MetaFormFieldsResult>("meta-form-fields", data);
}

export async function saveMetaFieldMapping(data: MetaSaveFieldMappingInput) {
  return invokeMetaFunction<{ ok: true }>("meta-field-mapping-save", data);
}

export async function createMetaTestLead(data: MetaTestLeadInput) {
  return invokeMetaFunction<MetaTestLeadResult>("meta-test-lead", data);
}
