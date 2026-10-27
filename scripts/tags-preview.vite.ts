import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import path from "node:path";
const mock = path.resolve(__dirname, "tags-preview-mocks.ts");
export default defineConfig({ plugins: [react(), tailwind()], resolve: { alias: [
  ...["@/hooks/use-crm-user", "@/hml/modules", "@/lib/commercial-tags.functions", "@tanstack/react-start"].map(find => ({ find, replacement: mock })),
  { find: "@", replacement: path.resolve(__dirname, "../src") },
] }, server: { host: "127.0.0.1", port: 4189, strictPort: true, watch: { ignored: ["**/.output/**", "**/.nitro/**"] } } });
