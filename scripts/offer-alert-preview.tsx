// Local visual fixture. No database requests or real customer data.
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { OfferAlertCard } from "../src/components/sales-offer-alert";
import "../src/styles.css";

const offer = {
  id: "preview",
  distribution_id: "preview",
  member_id: "preview",
  opportunity_title: "Marcos Vieira · Reserva Harmonia",
  status: "pending",
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 581000).toISOString(),
  resolved_at: null,
};
function Preview() {
  const [now, setNow] = useState(Date.now);
  const [result, setResult] = useState("");
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <main className="min-h-screen bg-muted/30 p-8">
      <p className="text-xs text-muted-foreground">PRÉVIA LOCAL · DADOS FICTÍCIOS</p>
      <h1 className="mt-4 text-2xl font-semibold">CRM comercial</h1>
      <p className="mt-2 text-muted-foreground">
        O aviso acompanha o corretor em qualquer tela do hub.
      </p>
      <p role="status">{result}</p>
      {!result && (
        <OfferAlertCard
          offer={offer}
          now={now}
          count={1}
          busy={false}
          muted={muted}
          soundReady={true}
          connectionError={false}
          onToggleSound={() => setMuted(!muted)}
          onAnswer={(action) =>
            setResult(
              action === "accept"
                ? "Lead aceito — simulação local"
                : "Oferta recusada — simulação local",
            )
          }
        />
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
