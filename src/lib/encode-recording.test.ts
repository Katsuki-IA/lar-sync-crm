import { it, expect } from "vitest";
import { encodeMonoMp3 } from "./encode-recording";
import { validateMediaFile, validateMediaSignature } from "../../supabase/functions/_shared/conversation-media";

it("codifica sinal de voz sintético em um MP3 aceito pelo servidor", async () => {
  const pcm = Float32Array.from({ length: 44100 }, (_, i) => Math.sin(i * 2 * Math.PI * 440 / 44100) * 0.5);
  const file = await encodeMonoMp3(pcm);
  expect(file.size).toBeGreaterThan(1000);
  expect(validateMediaFile(file.name, file.type, file.size)).toBe("audio");
  const bytes = new Uint8Array(await file.arrayBuffer());
  expect(() => validateMediaSignature(bytes, file.type)).not.toThrow();
});
