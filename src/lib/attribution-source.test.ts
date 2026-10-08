import { describe, expect, it } from "vitest";
import { getAttributionSource } from "./attribution-source";

describe("lead attribution source", () => {
  it("distinguishes a WhatsApp ad click from a Meta form", () => {
    expect(getAttributionSource({ capture_type: "ctwa" }, "Meta Ads")).toBe("Click to WhatsApp");
    expect(getAttributionSource({ meta_form_id: "form-1" }, "Meta Ads")).toBe("Meta Lead Ads");
  });
  it("does not infer an ad format from the Meta platform or operational WhatsApp origin", () => {
    expect(getAttributionSource({ source_type: "meta" }, "Meta Ads")).toBe("Meta Ads");
    expect(getAttributionSource(null, "WA - Whatsapp")).toBe("Não identificada");
    expect(getAttributionSource({ utm_source: "google" }, "Google Ads")).toBe("google");
  });
});
