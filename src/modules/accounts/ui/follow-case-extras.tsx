import Link from "next/link";
import type { Route } from "next";
import { partiesFromCaption } from "../domain/party-names";
import { topicsForNos } from "../domain/topics";
import { FollowEntityButton } from "./follow-entity-button";
import "./follow-entity-button.css";

/**
 * Under "Follow this case": follow the parties named in the caption, or the
 * case's topic, to hear about other public cases. Only names already shown
 * in the public caption are offered; anonymised names never are.
 */
export function FollowCaseExtras({ caption, natureOfSuit }: { caption: string; natureOfSuit?: string | null }) {
  const parties = partiesFromCaption(caption);
  const topic = topicsForNos(natureOfSuit)[0] ?? null;
  if (!parties.length && !topic) return null;
  return <div className="entityFollowExtras">
    <p className="entityFollowExtrasTitle">Alerts beyond this case</p>
    <ul>
      {parties.map((name) => <li key={name}>
        <span className="entityFollowExtrasName"><span className="entityFollowExtrasKind">Party</span> {name}</span>
        <FollowEntityButton kind="party" target={name} name={name} compact />
      </li>)}
      {topic ? <li>
        <span className="entityFollowExtrasName"><span className="entityFollowExtrasKind">Topic</span> <Link href={`/topics/${topic.slug}` as Route}>{topic.label}</Link></span>
        <FollowEntityButton kind="topic" target={topic.slug} name={topic.label} compact />
      </li> : null}
    </ul>
    <p className="entityFollowNote">New public cases naming a party, or new cases and filings in a topic. <Link href={"/alerts" as Route}>My alerts</Link></p>
  </div>;
}
