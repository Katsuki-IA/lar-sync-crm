export type ConversationTemplate = {
  name: string;
  language: string;
  status?: string;
  components?: Array<{
    type?: string;
    text?: string;
    format?: string;
    buttons?: Array<{ type?: string; url?: string }>;
    [key: string]: unknown;
  }>;
};

export function isAttendanceTemplate(template: ConversationTemplate) {
  return template.status === "APPROVED" && /^assumir_conversa_[1-9]\d*$/.test(template.name);
}

export type TemplateField = {
  key: string;
  label: string;
  component: "body" | "header" | "button";
  variable?: string;
  media?: string;
  buttonIndex?: number;
};

export function templateFields(template: ConversationTemplate): TemplateField[] {
  const fields: TemplateField[] = [];
  for (const component of template.components ?? []) {
    const type = component.type?.toLowerCase();
    if (type === "body" || (type === "header" && component.format === "TEXT")) {
      const variables = [
        ...new Set(Array.from((component.text ?? "").matchAll(/\{\{(\w+)\}\}/g), (m) => m[1])),
      ];
      variables.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      for (const variable of variables)
        fields.push({
          key: `${type}:${variable}`,
          label: `${type === "body" ? "Mensagem" : "Cabeçalho"}: ${variable}`,
          component: type,
          variable,
        });
    } else if (type === "header" && component.format && component.format !== "TEXT") {
      if (!["IMAGE", "VIDEO", "DOCUMENT"].includes(component.format))
        throw new Error("Este modelo usa um cabeçalho ainda não suportado pelo Hub.");
      fields.push({
        key: "header:media",
        label: `Link público do ${component.format === "IMAGE" ? "arquivo de imagem" : component.format === "VIDEO" ? "vídeo" : "documento"}`,
        component: "header",
        media: component.format.toLowerCase(),
      });
    } else if (type === "buttons") {
      for (const [index, button] of (component.buttons ?? []).entries()) {
        if (button.type === "URL" && /\{\{1\}\}/.test(button.url ?? ""))
          fields.push({
            key: `button:${index}`,
            label: `Complemento do link do botão ${index + 1}`,
            component: "button",
            buttonIndex: index,
          });
        else if (!["URL", "PHONE_NUMBER", "QUICK_REPLY"].includes(button.type ?? ""))
          throw new Error("Este modelo usa um botão ainda não suportado pelo Hub.");
      }
    }
  }
  return fields;
}

export function templatePreview(template: ConversationTemplate, values: Record<string, string>) {
  return (template.components ?? [])
    .filter((c) => ["HEADER", "BODY", "FOOTER"].includes(c.type ?? ""))
    .map((c) =>
      (c.text ?? "").replace(
        /\{\{(\w+)\}\}/g,
        (match, variable) => values[`${c.type?.toLowerCase()}:${variable}`]?.trim() || match,
      ),
    )
    .filter(Boolean)
    .join("\n\n");
}

export function buildTemplateComponents(
  template: ConversationTemplate,
  values: Record<string, unknown>,
) {
  const fields = templateFields(template);
  const components: Array<Record<string, unknown>> = [];
  for (const field of fields) {
    const value = typeof values[field.key] === "string" ? (values[field.key] as string).trim() : "";
    if (!value || value.length > 1024) throw new Error(`Preencha ${field.label}.`);
    if (field.media) {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throw new Error("Informe um link HTTPS válido para a mídia.");
      }
      if (url.protocol !== "https:") throw new Error("Informe um link HTTPS válido para a mídia.");
    }
    const parameter = field.media
      ? { type: field.media, [field.media]: { link: value } }
      : {
          type: "text",
          text: value,
          ...(field.variable && !/^\d+$/.test(field.variable)
            ? { parameter_name: field.variable }
            : {}),
        };
    if (field.component === "button")
      components.push({
        type: "button",
        sub_type: "url",
        index: String(field.buttonIndex),
        parameters: [parameter],
      });
    else {
      let component = components.find((c) => c.type === field.component);
      if (!component) {
        component = { type: field.component, parameters: [] };
        components.push(component);
      }
      (component.parameters as unknown[]).push(parameter);
    }
  }
  return components;
}
