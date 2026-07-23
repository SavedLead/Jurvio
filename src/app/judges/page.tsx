import type { Metadata } from "next";
import styles from "@/modules/directory/ui/directory.module.css";

export const metadata: Metadata = {
  title: "Judges in Public Court Records",
  description: "Judge profiles connected to source-backed public court records on Jurvio.",
  alternates: { canonical: "/judges" }, robots: { index: false, follow: true },
};

export default function JudgesPage() {
  return <main className={styles.page}><header className={styles.hero}>
    <p className={styles.eyebrow}>Public legal directory</p><h1>Judges</h1>
    <p>Judge profiles will organize source-backed opinions, case assignments, courts, and procedural records without editorial commentary.</p>
  </header><section className={styles.empty}><h2>No judge profiles are published yet</h2>
    <p>Opinion text can contain judge names, but Jurvio does not publish a profile until the person has a canonical, verified identity record.</p></section></main>;
}
