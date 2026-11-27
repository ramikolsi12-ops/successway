import Link from "next/link";
export default function NotFound() { return <main className="not-found"><h1>Page introuvable</h1><p>Cette page n’existe pas.</p><Link href="/tableau-de-bord">Revenir au tableau de bord</Link></main>; }
