"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="fr"><body style={{ margin: 0, fontFamily: "system-ui, sans-serif", color: "#18243c", background: "#f5f7fb" }}>
    <main style={{ maxWidth: 640, margin: "12vh auto", padding: 32 }}><h1>L’application n’a pas pu être chargée</h1>
      <p>Une erreur est survenue. Vérifiez que les services sont disponibles, puis réessayez.</p>
      <button type="button" onClick={reset} style={{ padding: "12px 20px", fontSize: 16, cursor: "pointer" }}>Réessayer</button>
    </main>
  </body></html>;
}
