export type ExplainerCategory = "starting a case" | "deciding a case" | "ending or pausing a case";

export interface ExplainerSource {
  label: string;
  url: string;
  note: string;
}

export interface LegalExplainer {
  slug: string;
  term: string;
  aliases: string[];
  category: ExplainerCategory;
  oneLine: string;
  plainEnglish: string;
  whyItMatters: string;
  whatHappensNext: string[];
  commonMistake: string;
  example: string;
  related: string[];
  sources: ExplainerSource[];
  reviewedOn: string;
}

const rules = "https://www.law.cornell.edu/rules/frcp";
const judiciary = "https://www.uscourts.gov/about-federal-courts/court-role-and-structure";

export const legalExplainers: readonly LegalExplainer[] = [
  {
    slug: "jurisdiction", term: "Jurisdiction", aliases: ["subject matter jurisdiction", "personal jurisdiction"], category: "starting a case",
    oneLine: "A court's legal power to hear a case and issue orders that bind the people involved.",
    plainEnglish: "A court cannot decide every disagreement. It needs authority over the type of dispute and, usually, over the defendant. Federal courts have limited power. Many disputes belong in state court instead.",
    whyItMatters: "If jurisdiction is missing, the court may dismiss the case or send it to another court, even if nobody raised the problem at first.",
    whatHappensNext: ["A party may challenge the court's power.", "The judge reviews the facts and the law that supposedly give the court authority.", "The case stays, is dismissed, or is sent to a proper court."],
    commonMistake: "Jurisdiction is not the same as venue. Jurisdiction asks whether the court has power. Venue asks whether this location is a proper place for the case.",
    example: "A federal court may hear a claim created by federal law. It may also hear some disputes between citizens of different states when the legal amount requirement is met.",
    related: ["venue", "standing", "remand"], reviewedOn: "2026-07-23",
    sources: [{ label: "U.S. Courts: Court role and structure", url: judiciary, note: "Official overview of federal court authority and structure." }, { label: "28 U.S.C. § 1331", url: "https://www.law.cornell.edu/uscode/text/28/1331", note: "Federal-question jurisdiction statute." }],
  },
  {
    slug: "venue", term: "Venue", aliases: ["proper venue", "forum"], category: "starting a case",
    oneLine: "The geographic court location where a case may properly be filed or heard.",
    plainEnglish: "Even when several courts have legal power, rules decide which places are fair and connected enough to the dispute. Venue often turns on where defendants live or where important events happened.",
    whyItMatters: "A case filed in the wrong place may be dismissed or transferred. The location can also affect cost, convenience, timing, and which law applies.",
    whatHappensNext: ["A defendant may object to the chosen location.", "The judge considers the parties, events, witnesses, and governing venue rules.", "The case remains, moves to another court, or is dismissed."],
    commonMistake: "A convenient courthouse is not automatically a legally proper venue.",
    example: "If a contract was negotiated and performed in one district, that district may have a strong connection to the dispute.",
    related: ["jurisdiction", "remand"], reviewedOn: "2026-07-23",
    sources: [{ label: "28 U.S.C. § 1391", url: "https://www.law.cornell.edu/uscode/text/28/1391", note: "General federal venue statute." }],
  },
  {
    slug: "standing", term: "Standing", aliases: ["Article III standing", "injury in fact"], category: "starting a case",
    oneLine: "The requirement that a person bringing a case has a real, personal stake in the dispute.",
    plainEnglish: "A person usually cannot sue only because something seems wrong. The person must show a real injury connected to the defendant's conduct and that the court can likely help fix it.",
    whyItMatters: "Without standing, a federal court lacks power to decide the merits of the claim.",
    whatHappensNext: ["The plaintiff identifies the injury and requested remedy.", "The defendant or judge may question whether the requirements are met.", "The court allows the claim to continue or dismisses it without deciding who was right about the underlying dispute."],
    commonMistake: "Standing does not mean the plaintiff will win. It only addresses whether this plaintiff may ask the court to decide this dispute.",
    example: "A customer who personally paid an allegedly unlawful fee may have a different stake than someone who only read about the fee.",
    related: ["jurisdiction", "motion-to-dismiss"], reviewedOn: "2026-07-23",
    sources: [{ label: "U.S. Constitution, Article III", url: "https://constitution.congress.gov/constitution/article-3/", note: "Official Constitution Annotated material on federal judicial power." }],
  },
  {
    slug: "dismissal-with-or-without-prejudice", term: "Dismissal with or without prejudice", aliases: ["with prejudice", "without prejudice"], category: "ending or pausing a case",
    oneLine: "A dismissal ends a claim; 'with prejudice' usually bars refiling it, while 'without prejudice' may allow another attempt.",
    plainEnglish: "The word prejudice here does not mean unfair bias. It describes whether the same claim may generally be filed again. A dismissal without prejudice can still have deadlines or other limits.",
    whyItMatters: "This wording helps show whether the loss is final and whether the plaintiff may correct a problem and return to court.",
    whatHappensNext: ["Read the exact order and identify which claims and parties it covers.", "Check whether amendment or refiling is allowed and whether a deadline applies.", "The parties may amend, refile, appeal, or treat the dispute as ended."],
    commonMistake: "Without prejudice does not guarantee that a claim can be refiled. A filing deadline or another legal barrier may still block it.",
    example: "A judge might dismiss a poorly written complaint without prejudice and give the plaintiff time to file a clearer version.",
    related: ["motion-to-dismiss", "appeal", "settlement"], reviewedOn: "2026-07-23",
    sources: [{ label: "Federal Rule of Civil Procedure 41", url: `${rules}/rule_41`, note: "Federal rule governing dismissal of actions." }],
  },
  {
    slug: "motion-to-dismiss", term: "Motion to dismiss", aliases: ["Rule 12 motion", "12(b)(6)"], category: "deciding a case",
    oneLine: "A request asking the judge to end some or all claims before trial because of a legal problem.",
    plainEnglish: "The defendant tells the judge that the case cannot move forward as written. One common argument is that even if the complaint's properly pleaded facts are accepted, the law does not provide a valid claim.",
    whyItMatters: "The ruling may narrow the case, end it, or let the plaintiff fix the complaint. It usually is not a trial about whose evidence is more believable.",
    whatHappensNext: ["The moving party files the motion and legal reasons.", "The other side responds, and the moving party may reply.", "The judge denies the motion, dismisses claims, or allows an amended complaint."],
    commonMistake: "A denied motion does not mean the plaintiff won the case. It generally means the claim may continue to the next stage.",
    example: "A defendant may argue that the complaint describes rude behavior but does not allege every element required for the stated legal claim.",
    related: ["dismissal-with-or-without-prejudice", "summary-judgment", "jurisdiction"], reviewedOn: "2026-07-23",
    sources: [{ label: "Federal Rule of Civil Procedure 12", url: `${rules}/rule_12`, note: "Federal rule governing defenses and motions attacking pleadings." }],
  },
  {
    slug: "summary-judgment", term: "Summary judgment", aliases: ["Rule 56", "partial summary judgment"], category: "deciding a case",
    oneLine: "A decision without a trial when no genuine dispute over a material fact requires a factfinder.",
    plainEnglish: "After the parties gather evidence, one side may argue that the important facts are not genuinely disputed and the law requires a particular result. The judge does not simply choose which witness seems nicer.",
    whyItMatters: "Summary judgment can end the whole case or decide only certain claims or issues, making any later trial smaller.",
    whatHappensNext: ["A party identifies evidence and the legal rule it says controls.", "The other side points to evidence showing a real dispute about an important fact.", "The judge grants, partly grants, or denies the motion."],
    commonMistake: "Denial does not mean the opposing side won. It often means a trial or more proceedings are needed to resolve disputed facts.",
    example: "If both sides agree a contract was signed but dispute what happened afterward, the disputed event may require a trial if it changes the legal result.",
    related: ["trial", "appeal", "motion-to-dismiss"], reviewedOn: "2026-07-23",
    sources: [{ label: "Federal Rule of Civil Procedure 56", url: `${rules}/rule_56`, note: "Federal rule governing summary judgment." }],
  },
  {
    slug: "trial", term: "Trial", aliases: ["jury trial", "bench trial"], category: "deciding a case",
    oneLine: "A formal proceeding where evidence is presented and disputed facts are decided.",
    plainEnglish: "At trial, each side presents admissible evidence and questions witnesses. A jury decides facts in a jury trial. A judge decides facts in a bench trial. The judge manages the law in both.",
    whyItMatters: "A trial creates findings or a verdict that can lead to judgment. Many cases end earlier through dismissal, summary judgment, or settlement.",
    whatHappensNext: ["The court handles final pretrial issues and selects a jury if needed.", "The parties present evidence, question witnesses, and make arguments.", "The factfinder reaches a verdict or findings, and the court enters judgment."],
    commonMistake: "A hearing is not always a trial. Courts hold many shorter hearings about procedure, evidence, or temporary relief.",
    example: "In a contract trial, witnesses and records may help the factfinder decide whether a promise was broken and what harm resulted.",
    related: ["summary-judgment", "appeal", "settlement"], reviewedOn: "2026-07-23",
    sources: [{ label: "U.S. Courts: Civil cases", url: "https://www.uscourts.gov/about-federal-courts/types-cases/civil-cases", note: "Official overview of a federal civil case." }, { label: "Federal Rules of Civil Procedure", url: rules, note: "Rules governing federal civil proceedings." }],
  },
  {
    slug: "appeal", term: "Appeal", aliases: ["appellate review", "notice of appeal"], category: "ending or pausing a case",
    oneLine: "A request for a higher court to review claimed legal errors in a lower court decision.",
    plainEnglish: "An appeal is usually not a new trial. The appellate court reviews the existing record, written briefs, and sometimes oral argument. Different issues receive different levels of review.",
    whyItMatters: "The higher court may leave the decision alone, change it, reverse it, or send the case back for more work.",
    whatHappensNext: ["An eligible party files a timely notice of appeal.", "The parties submit the record and written briefs.", "The appellate court decides the appeal and may affirm, reverse, modify, or remand."],
    commonMistake: "Filing an appeal does not always pause enforcement of the judgment. A separate stay may be required.",
    example: "A party may argue that the trial judge applied the wrong legal test, while the other side argues the ruling should remain in place.",
    related: ["remand", "trial", "summary-judgment"], reviewedOn: "2026-07-23",
    sources: [{ label: "U.S. Courts: Appeals", url: "https://www.uscourts.gov/about-federal-courts/types-cases/appeals", note: "Official overview of federal appeals." }, { label: "Federal Rules of Appellate Procedure", url: "https://www.law.cornell.edu/rules/frap", note: "Rules governing appeals in federal courts of appeals." }],
  },
  {
    slug: "remand", term: "Remand", aliases: ["remanded", "remand order"], category: "ending or pausing a case",
    oneLine: "An order sending a case back to another court or decision-maker for further action.",
    plainEnglish: "Remand means 'send back.' A federal trial court may return a removed case to state court. An appellate court may also return a case to the lower court with instructions.",
    whyItMatters: "The dispute may continue even though one court has finished with it. The remand order explains where it goes and often what must happen next.",
    whatHappensNext: ["Read which court or agency receives the case.", "Identify any instructions or limits in the remand order.", "The receiving court resumes the proceedings under those instructions."],
    commonMistake: "Remand is not automatically a win on the underlying claims. It often changes where or how the case continues.",
    example: "A federal judge who finds no basis for federal jurisdiction may remand a removed lawsuit to the state court where it began.",
    related: ["jurisdiction", "venue", "appeal"], reviewedOn: "2026-07-23",
    sources: [{ label: "28 U.S.C. § 1447", url: "https://www.law.cornell.edu/uscode/text/28/1447", note: "Federal statute covering procedure after removal, including remand." }],
  },
  {
    slug: "injunction-and-tro", term: "Injunction and temporary restraining order", aliases: ["injunction", "TRO", "preliminary injunction"], category: "deciding a case",
    oneLine: "A court order requiring someone to do something or stop doing something, sometimes on an emergency basis.",
    plainEnglish: "A temporary restraining order, often called a TRO, is short-term emergency relief. A preliminary injunction can last while the case continues. A permanent injunction may be part of the final judgment.",
    whyItMatters: "These orders can change conduct before the whole case is decided. Because the effect can be immediate, courts apply specific requirements and procedures.",
    whatHappensNext: ["The requesting party explains the threatened harm and requested order.", "The other side receives notice except in limited emergency circumstances.", "The judge grants, narrows, denies, extends, or dissolves the requested relief."],
    commonMistake: "A TRO or preliminary injunction does not necessarily decide the final winner. It controls the situation while the court considers the case.",
    example: "A court might temporarily block a challenged rule from taking effect while it considers whether the rule is lawful.",
    related: ["trial", "appeal", "settlement"], reviewedOn: "2026-07-23",
    sources: [{ label: "Federal Rule of Civil Procedure 65", url: `${rules}/rule_65`, note: "Federal rule governing injunctions and restraining orders." }],
  },
  {
    slug: "settlement", term: "Settlement", aliases: ["settlement agreement", "consent judgment"], category: "ending or pausing a case",
    oneLine: "An agreement that resolves some or all of a dispute without having the judge or jury decide every issue.",
    plainEnglish: "The parties choose agreed terms instead of continuing to fight. Terms may include payment, changed conduct, confidentiality, or dismissal. The agreement may be private or may require court action.",
    whyItMatters: "Settlement can end the case, but the public docket may not reveal every term. A settlement also is not automatically an admission that either side was wrong.",
    whatHappensNext: ["The parties negotiate and document their agreement.", "They complete any required payments, actions, or court filings.", "Claims are dismissed or the court enters an agreed order when appropriate."],
    commonMistake: "A settlement amount or agreement should not be assumed unless a reliable source actually discloses it.",
    example: "The parties may agree to payment and then file a joint notice dismissing the lawsuit without asking the judge to decide liability.",
    related: ["dismissal-with-or-without-prejudice", "trial", "injunction-and-tro"], reviewedOn: "2026-07-23",
    sources: [{ label: "Federal Rule of Civil Procedure 41", url: `${rules}/rule_41`, note: "Federal rule addressing voluntary and involuntary dismissal." }, { label: "U.S. Courts: Civil cases", url: "https://www.uscourts.gov/about-federal-courts/types-cases/civil-cases", note: "Official overview noting that parties may resolve civil cases by agreement." }],
  },
] as const;

export function getExplainer(slug: string): LegalExplainer | undefined {
  return legalExplainers.find((explainer) => explainer.slug === slug);
}

export function explainerGlossary() {
  return legalExplainers.map(({ slug, term, aliases, oneLine, category, reviewedOn }) => ({
    slug, term, aliases, definition: oneLine, category, reviewedOn,
  }));
}
