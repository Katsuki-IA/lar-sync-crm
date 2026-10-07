import { describe, expect, it } from "vitest";
import {
  buildTemplateComponents,
  isAttendanceTemplate,
  templateFields,
  templatePreview,
  type ConversationTemplate,
} from "../../supabase/functions/_shared/conversation-templates";

const template: ConversationTemplate = {
  name: "assumir_conversa_1",
  language: "pt_BR",
  status: "APPROVED",
  components: [{ type: "BODY", text: "Olá, {{1}}! Sou {{2}}. Posso ajudar?" }],
};

describe("templates para assumir conversas", () => {
  it("aceita somente modelos aprovados com o nome e número definidos", () => {
    expect(
      ["assumir_conversa_1", "assumir_conversa_2", "assumir_conversa_15"].every((name) =>
        isAttendanceTemplate({ ...template, name }),
      ),
    ).toBe(true);
    for (const name of [
      "default",
      "assumir_conversa",
      "assumir_conversa_0",
      "assumir_conversa_1_teste",
      "outro_assumir_conversa_1",
    ])
      expect(isAttendanceTemplate({ ...template, name })).toBe(false);
    expect(isAttendanceTemplate({ ...template, status: "PENDING" })).toBe(false);
    expect(isAttendanceTemplate({ ...template, status: "PAUSED" })).toBe(false);
  });
  it("exige os parâmetros e monta o payload e a prévia na ordem correta", () => {
    expect(() => buildTemplateComponents(template, { "body:1": "Ana" })).toThrow("Mensagem: 2");
    const values = { "body:1": " Ana ", "body:2": "João" };
    expect(buildTemplateComponents(template, values)).toEqual([
      {
        type: "body",
        parameters: [
          { type: "text", text: "Ana" },
          { type: "text", text: "João" },
        ],
      },
    ]);
    expect(templatePreview(template, values)).toBe("Olá, Ana! Sou João. Posso ajudar?");
  });
  it("envia modelos sem variáveis sem componentes adicionais", () => {
    expect(
      buildTemplateComponents(
        { ...template, components: [{ type: "BODY", text: "Podemos conversar?" }] },
        {},
      ),
    ).toEqual([]);
  });
  it("suporta variáveis nomeadas, mídia e botão de link dinâmico", () => {
    const media: ConversationTemplate = {
      ...template,
      components: [
        { type: "HEADER", format: "IMAGE" },
        { type: "BODY", text: "Olá, {{nome}}" },
        {
          type: "BUTTONS",
          buttons: [{ type: "URL", url: "https://example.com/{{1}}" }, { type: "QUICK_REPLY" }],
        },
      ],
    };
    expect(templateFields(media).map((f) => f.key)).toEqual([
      "header:media",
      "body:nome",
      "button:0",
    ]);
    const values = {
      "header:media": "https://example.com/image.png",
      "body:nome": "Ana",
      "button:0": "lead",
    };
    expect(buildTemplateComponents(media, values)).toEqual([
      {
        type: "header",
        parameters: [{ type: "image", image: { link: "https://example.com/image.png" } }],
      },
      { type: "body", parameters: [{ type: "text", text: "Ana", parameter_name: "nome" }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "lead" }] },
    ]);
    expect(() =>
      buildTemplateComponents(media, { ...values, "header:media": "file:///secret" }),
    ).toThrow("HTTPS");
  });
  it("bloqueia componentes que não podem ser enviados corretamente", () => {
    expect(() =>
      templateFields({ ...template, components: [{ type: "HEADER", format: "LOCATION" }] }),
    ).toThrow("não suportado");
    expect(() =>
      templateFields({
        ...template,
        components: [{ type: "BUTTONS", buttons: [{ type: "COPY_CODE" }] }],
      }),
    ).toThrow("não suportado");
  });
});
