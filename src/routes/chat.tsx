import { createFileRoute } from "@tanstack/react-router";
import { ClaraChat } from "@/components/clara-chat/clara-chat";

export const Route = createFileRoute("/chat")({
  head: () => ({
    meta: [
      { title: "Fale com a Clara | Katsuki" },
      { name: "description", content: "Converse com a Clara, assistente da Katsuki, sobre WhatsApp oficial com IA para o seu negócio." },
      { property: "og:title", content: "Fale com a Clara | Katsuki" },
      { property: "og:description", content: "Converse com a Clara, assistente da Katsuki, sobre WhatsApp oficial com IA." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ClaraChat,
});
