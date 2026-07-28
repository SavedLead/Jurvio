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
  {
    slug: "per-curiam", term: "Per curiam", aliases: ["per curiam opinion"], category: "deciding a case",
    oneLine: "A court opinion issued in the Court's name rather than signed by one identified justice.",
    plainEnglish: "Per curiam is Latin for 'by the court.' The label tells you the opinion is attributed to the Court as an institution. It does not, by itself, say whether the case was easy, unanimous, or unimportant.",
    whyItMatters: "It explains why no single justice is listed as the opinion's author.",
    whatHappensNext: ["Read the judgment and reasoning as the Court's opinion.", "Check separately for signed concurrences or dissents."],
    commonMistake: "Per curiam does not automatically mean every justice agreed.",
    example: "The heading may say 'Per Curiam' where another opinion would name the justice who wrote for the Court.",
    related: ["appeal", "writ-of-certiorari"], reviewedOn: "2026-07-28",
    sources: [{ label: "Supreme Court: Opinions", url: "https://www.supremecourt.gov/opinions/opinions.aspx", note: "Official Supreme Court opinion publication page." }],
  },
  {
    slug: "writ-of-certiorari", term: "Writ of certiorari", aliases: ["certiorari", "petition for certiorari", "cert. petition"], category: "starting a case",
    oneLine: "An order by which the Supreme Court agrees to review a lower court's decision.",
    plainEnglish: "A party usually asks the Supreme Court to take a case by filing a petition for a writ of certiorari. If the Court grants it, the Court will review the case. If the Court denies it, the lower court decision remains in place without the Supreme Court endorsing that decision.",
    whyItMatters: "It identifies how most cases reach the Supreme Court and whether review was granted.",
    whatHappensNext: ["The parties brief whether the Court should hear the case.", "If review is granted, merits briefing and sometimes oral argument follow."],
    commonMistake: "A denial of certiorari is not a ruling that the lower court was correct.",
    example: "The phrase 'on petition for writ of certiorari' means the Court is acting on a request to review the lower court.",
    related: ["appeal", "remand"], reviewedOn: "2026-07-28",
    sources: [{ label: "Supreme Court Rule 10", url: "https://www.supremecourt.gov/ctrules/2019RulesoftheCourt.pdf", note: "Official rules describing considerations governing certiorari review." }],
  },
  {
    slug: "petitioner-and-respondent", term: "Petitioner and respondent", aliases: ["petitioner", "respondent"], category: "starting a case",
    oneLine: "The petitioner asks a reviewing court to act; the respondent answers that request.",
    plainEnglish: "At the Supreme Court, the petitioner is generally the party asking the Court to review or change the lower court result. The respondent is the opposing party. These labels can differ from plaintiff and defendant below.",
    whyItMatters: "The labels show each party's role in the proceeding now before the Court.",
    whatHappensNext: ["The petitioner presents the requested relief.", "The respondent argues how the Court should answer."],
    commonMistake: "Petitioner does not always mean the person who originally filed the lawsuit.",
    example: "A defendant who lost in a lower court may become the petitioner at the Supreme Court.",
    related: ["writ-of-certiorari", "appeal"], reviewedOn: "2026-07-28",
    sources: [{ label: "Supreme Court: Guide for prospective indigent petitioners", url: "https://www.supremecourt.gov/casehand/guideforIFPcases2019.pdf", note: "Official Court guide describing petitions and responses." }],
  },
  {
    slug: "affirmed", term: "Affirmed", aliases: ["affirmance", "affirming"], category: "ending or pausing a case",
    oneLine: "The reviewing court leaves the lower court's judgment in place.",
    plainEnglish: "An affirmance means the lower court's result stands. The reviewing court may agree with all, some, or different reasoning, so the opinion should be read for the exact basis.",
    whyItMatters: "It states the immediate result of appellate review.",
    whatHappensNext: ["The lower court judgment remains effective.", "Any further review depends on the available procedure and deadlines."],
    commonMistake: "Affirmed does not necessarily approve every sentence in the lower court's opinion.",
    example: "The judgment is affirmed means the reviewing court did not overturn the result.",
    related: ["appeal", "remand"], reviewedOn: "2026-07-28",
    sources: [{ label: "U.S. Courts: Appeals", url: "https://www.uscourts.gov/about-federal-courts/types-cases/appeals", note: "Official overview of federal appellate review." }],
  },
  {
    slug: "reversed", term: "Reversed", aliases: ["reversal", "reversing"], category: "ending or pausing a case",
    oneLine: "The reviewing court overturns the lower court's judgment in whole or in part.",
    plainEnglish: "A reversal means the lower court's result cannot stand as issued. The reviewing court's instructions determine whether another judgment follows or more proceedings are needed.",
    whyItMatters: "It changes the result reached below.",
    whatHappensNext: ["Read the opinion's exact instructions.", "The lower court may enter a new result or conduct further proceedings."],
    commonMistake: "Reversal does not always end the dispute.",
    example: "A court may reverse a judgment and send the case back for a new trial.",
    related: ["appeal", "remand"], reviewedOn: "2026-07-28",
    sources: [{ label: "U.S. Courts: Appeals", url: "https://www.uscourts.gov/about-federal-courts/types-cases/appeals", note: "Official overview of federal appellate review." }],
  },
  {
    slug: "vacated", term: "Vacated", aliases: ["vacatur", "vacating"], category: "ending or pausing a case",
    oneLine: "The court sets aside a judgment or order so it no longer has its prior legal effect.",
    plainEnglish: "To vacate is to nullify the specified ruling. The case may still continue, often under instructions from the reviewing court.",
    whyItMatters: "It tells readers that the specified lower court ruling has been set aside.",
    whatHappensNext: ["Identify exactly which judgment or order was vacated.", "Follow any remand instructions for further proceedings."],
    commonMistake: "Vacated does not necessarily mean the entire case is over.",
    example: "The Court may vacate the judgment and remand the case for reconsideration under a new legal rule.",
    related: ["remand", "appeal"], reviewedOn: "2026-07-28",
    sources: [{ label: "U.S. Courts: Appeals", url: "https://www.uscourts.gov/about-federal-courts/types-cases/appeals", note: "Official overview of federal appellate review." }],
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
