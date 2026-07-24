export type GlossaryStage =
  | "before filing"
  | "starting a case"
  | "pleadings and response"
  | "discovery"
  | "motions"
  | "trial"
  | "judgment and remedies"
  | "appeal"
  | "case status";

export type GlossaryTrack = "general" | "federal" | "state" | "scotus";

export interface GlossaryTerm {
  term: string;
  definition: string;
  stage: GlossaryStage;
  track: GlossaryTrack;
  popularity: 1 | 2 | 3 | 4 | 5;
  aliases?: string[];
  explainerSlug?: string;
}

const t = (
  term: string,
  definition: string,
  stage: GlossaryStage,
  popularity: GlossaryTerm["popularity"],
  track: GlossaryTrack = "general",
  aliases?: string[],
  explainerSlug?: string,
): GlossaryTerm => ({ term, definition, stage, popularity, track, aliases, explainerSlug });

export const glossaryTerms: readonly GlossaryTerm[] = [
  t("Lawsuit", "A dispute formally brought before a court.", "starting a case", 5),
  t("Plaintiff", "The person or organization that starts a civil case.", "starting a case", 5),
  t("Defendant", "The person or organization against whom a case or charge is brought.", "starting a case", 5),
  t("Complaint", "The filing that begins a civil lawsuit and states the plaintiff's claims.", "starting a case", 5),
  t("Claim", "A legal ground for requesting relief from a court.", "starting a case", 5),
  t("Docket", "The court's chronological record of filings, orders, and events in a case.", "case status", 5),
  t("Hearing", "A court session addressing an issue, motion, evidence, or case management.", "motions", 5),
  t("Motion", "A formal request asking a court to issue a ruling or order.", "motions", 5),
  t("Order", "A direction or decision issued by a judge or court.", "case status", 5),
  t("Judgment", "The court's formal, enforceable resolution of claims or a case.", "judgment and remedies", 5),
  t("Appeal", "A request for a higher court to review a lower court decision.", "appeal", 5, "general", ["appellate review"], "appeal"),
  t("Settlement", "An agreement resolving some or all of a dispute without a full decision at trial.", "judgment and remedies", 5, "general", undefined, "settlement"),
  t("Trial", "A proceeding where evidence is presented and disputed facts are decided.", "trial", 5, "general", ["jury trial", "bench trial"], "trial"),
  t("Evidence", "Information offered to prove or disprove a fact.", "discovery", 5),
  t("Jurisdiction", "A court's legal authority to hear a case and bind the parties.", "starting a case", 5, "general", ["subject-matter jurisdiction", "personal jurisdiction"], "jurisdiction"),
  t("Venue", "The legally proper geographic location for a case.", "starting a case", 4, "general", ["forum"], "venue"),
  t("Standing", "The requirement that a party have a real, legally recognized stake in a dispute.", "starting a case", 4, "federal", ["Article III standing"], "standing"),
  t("Summons", "Official notice directing a defendant to respond to a filed case.", "starting a case", 4),
  t("Service of process", "The formal delivery of required court papers to a party.", "starting a case", 4, "general", ["service"]),
  t("Answer", "A defendant's formal response admitting, denying, or addressing allegations.", "pleadings and response", 4),
  t("Allegation", "A factual assertion that has not necessarily been proven.", "pleadings and response", 5),
  t("Pleading", "A formal filing stating claims, defenses, or responses.", "pleadings and response", 4),
  t("Motion to dismiss", "A request to end claims because of a legal defect before trial.", "motions", 5, "general", ["Rule 12 motion", "12(b)(6)"], "motion-to-dismiss"),
  t("Summary judgment", "A ruling without trial when no genuine dispute of material fact requires a factfinder.", "motions", 5, "general", ["Rule 56"], "summary-judgment"),
  t("Dismissed with prejudice", "Ended in a way that usually prevents the same claim from being filed again.", "judgment and remedies", 5, "general", undefined, "dismissal-with-or-without-prejudice"),
  t("Dismissed without prejudice", "Ended in a way that may allow the claim to be corrected and filed again.", "judgment and remedies", 5, "general", undefined, "dismissal-with-or-without-prejudice"),
  t("Injunction", "An order requiring a person to act or stop acting.", "judgment and remedies", 4, "general", ["preliminary injunction", "permanent injunction"], "injunction-and-tro"),
  t("Temporary restraining order", "Short-term emergency relief intended to preserve conditions until further review.", "motions", 4, "general", ["TRO"], "injunction-and-tro"),
  t("Discovery", "The pretrial process for exchanging information and gathering evidence.", "discovery", 5),
  t("Deposition", "Sworn out-of-court testimony recorded for use in a case.", "discovery", 4),
  t("Subpoena", "A command requiring testimony, documents, or other evidence.", "discovery", 4),
  t("Interrogatories", "Written questions that another party must answer under oath.", "discovery", 3),
  t("Request for production", "A formal request for documents, data, or tangible items.", "discovery", 3),
  t("Request for admission", "A request asking another party to admit or deny specific statements.", "discovery", 3),
  t("Privilege", "A rule allowing certain protected communications or information to remain undisclosed.", "discovery", 4),
  t("Attorney-client privilege", "Protection for qualifying confidential communications between a lawyer and client.", "discovery", 5),
  t("Work product", "Protection for certain materials prepared in anticipation of litigation.", "discovery", 3),
  t("Protective order", "An order limiting disclosure, use, or handling of information.", "discovery", 3),
  t("Sanctions", "Penalties imposed for violating rules, orders, or litigation duties.", "case status", 4),
  t("Contempt of court", "A finding that someone disobeyed or seriously disrupted the court's authority.", "case status", 4),
  t("Affidavit", "A written statement sworn or affirmed to be true.", "discovery", 4),
  t("Declaration", "A written factual statement made under penalty of perjury.", "discovery", 4),
  t("Exhibit", "A document, object, or other item presented as evidence.", "discovery", 4),
  t("Testimony", "Statements given by a witness under oath or affirmation.", "trial", 4),
  t("Witness", "A person who provides testimony or evidence.", "trial", 5),
  t("Expert witness", "A qualified person permitted to offer specialized opinion testimony.", "trial", 4),
  t("Hearsay", "An out-of-court statement offered to prove what it asserts, subject to rules and exceptions.", "trial", 4),
  t("Objection", "A request that the court disallow a question, answer, exhibit, or procedure.", "trial", 5),
  t("Admissible", "Allowed to be considered as evidence under the governing rules.", "trial", 4),
  t("Burden of proof", "The obligation to prove a claim, defense, or disputed issue.", "trial", 5),
  t("Preponderance of the evidence", "The common civil standard meaning more likely than not.", "trial", 4),
  t("Beyond a reasonable doubt", "The high proof standard required for a criminal conviction.", "trial", 5),
  t("Jury", "A group selected to decide facts and, where authorized, reach a verdict.", "trial", 5),
  t("Bench trial", "A trial where the judge, rather than a jury, decides disputed facts.", "trial", 4, "general", undefined, "trial"),
  t("Verdict", "A jury's formal decision on issues submitted to it.", "trial", 5),
  t("Liability", "Legal responsibility for conduct or harm.", "judgment and remedies", 5),
  t("Damages", "Money awarded to compensate for loss or address legally recognized harm.", "judgment and remedies", 5),
  t("Compensatory damages", "Money intended to compensate for proven loss.", "judgment and remedies", 4),
  t("Punitive damages", "Money intended to punish and deter especially wrongful conduct where permitted.", "judgment and remedies", 4),
  t("Declaratory judgment", "A binding statement defining the parties' legal rights or obligations.", "judgment and remedies", 3),
  t("Default", "Failure to respond or take a required step within the allowed time.", "pleadings and response", 4),
  t("Default judgment", "A judgment entered after a party fails to defend or respond, subject to applicable rules.", "judgment and remedies", 4),
  t("Counterclaim", "A claim asserted by a defending party against an opposing party.", "pleadings and response", 4),
  t("Crossclaim", "A claim by one party against a co-party in the same side of a case.", "pleadings and response", 2),
  t("Third-party complaint", "A filing bringing another person into a case based on related responsibility.", "pleadings and response", 2),
  t("Class action", "A case in which representatives seek relief for a defined group.", "starting a case", 4),
  t("Class certification", "A ruling on whether a proposed group may proceed together as a class.", "motions", 4),
  t("Amicus curiae", "A nonparty permitted to offer information or argument to assist the court.", "appeal", 3, "general", ["friend of the court"]),
  t("Pro se", "Representing oneself without a lawyer.", "starting a case", 4),
  t("Counsel", "A lawyer or lawyers representing a party.", "case status", 4),
  t("Counsel of record", "A lawyer formally listed as representing a party in the case.", "case status", 3),
  t("Recusal", "A judge's withdrawal from a case because impartiality could reasonably be questioned or another rule applies.", "case status", 3),
  t("Magistrate judge", "A federal judicial officer who handles assigned pretrial and other authorized matters.", "case status", 3, "federal"),
  t("District court", "The principal federal trial court, or a state trial court in some systems.", "starting a case", 4),
  t("Circuit court", "Usually a federal court of appeals, though the name has different meanings in some states.", "appeal", 4),
  t("Supreme Court", "The highest court in a court system; the U.S. Supreme Court is the final federal court.", "appeal", 5),
  t("Removal", "Transfer of an eligible state-court case to federal court.", "starting a case", 3, "federal"),
  t("Remand", "An order sending a matter back to a lower court, state court, or agency.", "appeal", 4, "general", undefined, "remand"),
  t("Diversity jurisdiction", "Federal jurisdiction over certain disputes between citizens of different states or countries.", "starting a case", 3, "federal"),
  t("Federal question", "A claim arising under the U.S. Constitution, federal law, or a treaty.", "starting a case", 4, "federal"),
  t("PACER", "The federal judiciary's electronic public access system for court records.", "case status", 4, "federal"),
  t("ECF", "The federal courts' electronic case filing system.", "case status", 3, "federal", ["CM/ECF"]),
  t("Case number", "The identifier assigned by a court to a case.", "case status", 5, "general", ["docket number"]),
  t("Caption", "The heading naming the court, parties, and case number.", "case status", 3),
  t("Minute entry", "A brief docket record summarizing a proceeding or court action.", "case status", 3),
  t("Scheduling order", "An order setting deadlines and milestones for managing a case.", "case status", 4),
  t("Status conference", "A hearing where the court and parties discuss progress, deadlines, or next steps.", "case status", 4),
  t("Continuance", "A postponement of a hearing, trial, or deadline.", "case status", 4),
  t("Stay", "A pause in proceedings or enforcement of a ruling.", "case status", 5),
  t("Moot", "No longer presenting a live dispute that the court can meaningfully resolve.", "case status", 4, "federal"),
  t("Ripe", "Ready for judicial review because the dispute has developed enough to be concrete.", "before filing", 3, "federal"),
  t("Statute of limitations", "The deadline for bringing a particular kind of legal claim.", "before filing", 5),
  t("Tolling", "A rule that pauses or extends a legal time period under specified circumstances.", "before filing", 3),
  t("Cause of action", "A recognized legal basis for seeking relief.", "before filing", 4),
  t("Demand letter", "A pre-suit communication requesting payment, action, or resolution.", "before filing", 4),
  t("Arbitration", "A private dispute-resolution process in which an arbitrator issues a decision.", "before filing", 5),
  t("Mediation", "A confidential process in which a neutral helps parties try to reach agreement.", "before filing", 5),
  t("Choice of law", "Rules determining which jurisdiction's substantive law governs an issue.", "motions", 3),
  t("Precedent", "An earlier judicial decision used as authority in a later case.", "motions", 5),
  t("Binding precedent", "Earlier authority that a court generally must follow.", "motions", 4),
  t("Persuasive authority", "Legal authority a court may consider but is not required to follow.", "motions", 3),
  t("Citation", "A standardized reference to a case, statute, rule, or other authority.", "motions", 4),
  t("Brief", "A written presentation of facts, law, and argument submitted to a court.", "motions", 5),
  t("Memorandum opinion", "A written judicial explanation of a ruling, often focused on the issues before the court.", "case status", 3),
  t("Per curiam", "An opinion issued in the court's name rather than under one judge's name.", "appeal", 3),
  t("Majority opinion", "The opinion expressing the reasoning supported by most judges deciding the case.", "appeal", 4),
  t("Concurring opinion", "A separate opinion agreeing with the result but adding or differing in reasoning.", "appeal", 3),
  t("Dissenting opinion", "A separate opinion disagreeing with the court's result or reasoning.", "appeal", 4),
  t("Affirmed", "The reviewing court left the lower decision in place.", "appeal", 5),
  t("Reversed", "The reviewing court overturned all or part of the lower decision.", "appeal", 5),
  t("Vacated", "A court nullified a prior judgment or order.", "appeal", 4),
  t("Mandate", "The appellate court's formal instruction returning authority to the lower court.", "appeal", 3),
  t("Notice of appeal", "The filing that begins an appeal.", "appeal", 4),
  t("Oral argument", "A scheduled session where lawyers answer judges' questions and present legal positions.", "appeal", 4),
  t("Petition for rehearing", "A request that an appellate court reconsider its decision.", "appeal", 3),
  t("En banc", "Review by all or a larger group of a circuit's active judges rather than the usual panel.", "appeal", 3, "federal"),
  t("Certiorari", "Discretionary Supreme Court review requested through a petition.", "appeal", 5, "scotus", ["cert", "writ of certiorari"]),
  t("Petition for certiorari", "A filing asking the U.S. Supreme Court to review a lower-court decision.", "appeal", 4, "scotus", ["cert petition"]),
  t("Cert granted", "The Supreme Court agreed to hear the case.", "appeal", 5, "scotus"),
  t("Cert denied", "The Supreme Court declined review without expressing approval of the lower decision.", "appeal", 5, "scotus"),
  t("Merits brief", "A brief addressing how the Supreme Court should decide the accepted questions.", "appeal", 3, "scotus"),
  t("Question presented", "The precisely framed legal issue a Supreme Court petition asks the Court to decide.", "appeal", 3, "scotus"),
  t("Opinion of the Court", "The Supreme Court opinion stating the controlling judgment and reasoning.", "appeal", 4, "scotus"),
  t("Shadow docket", "An informal label for Supreme Court orders and emergency matters outside full merits decisions.", "appeal", 4, "scotus"),
  t("Emergency application", "A request for urgent Supreme Court action, often involving a stay or injunction.", "appeal", 4, "scotus"),
  t("GVR", "An order granting review, vacating the decision, and remanding for reconsideration.", "appeal", 2, "scotus", ["grant, vacate, and remand"]),
  t("State trial court", "A state court that first hears evidence and decides civil or criminal matters.", "starting a case", 4, "state"),
  t("Intermediate appellate court", "A state reviewing court below the state's highest court.", "appeal", 3, "state"),
  t("State supreme court", "A state's highest court, though some states use a different name.", "appeal", 4, "state"),
  t("Verified complaint", "A complaint whose factual allegations are sworn or affirmed as true.", "starting a case", 3, "state"),
  t("Order to show cause", "A direction requiring a party to explain why requested relief should not be granted.", "motions", 4, "state"),
  t("Demurrer", "In some states, a pleading challenging whether allegations state a legally sufficient claim.", "motions", 3, "state"),
  t("Writ", "A formal court command directing an act or review, with meaning depending on the particular writ.", "appeal", 3),
  t("Habeas corpus", "A proceeding challenging the legality of a person's detention.", "appeal", 4, "federal"),
  t("Mandamus", "Extraordinary relief ordering a public official or lower court to perform a required duty.", "appeal", 3),
] as const;

export const glossaryStages: readonly GlossaryStage[] = [
  "before filing", "starting a case", "pleadings and response", "discovery", "motions",
  "trial", "judgment and remedies", "appeal", "case status",
];

export const procedureTracks = [
  {
    id: "federal",
    label: "Federal court",
    steps: ["Jurisdiction and filing", "Service and response", "Discovery", "Motions", "Trial or resolution", "Federal appeal"],
  },
  {
    id: "state",
    label: "State court",
    steps: ["State filing rules", "Service and pleadings", "Discovery", "State motions", "Trial or resolution", "State appeals"],
  },
  {
    id: "scotus",
    label: "U.S. Supreme Court",
    steps: ["Petition for certiorari", "Cert-stage briefing", "Grant or denial", "Merits briefing", "Oral argument", "Opinion or order"],
  },
] as const;

export function popularGlossaryTerms(limit = 24) {
  return [...glossaryTerms]
    .sort((a, b) => b.popularity - a.popularity || a.term.localeCompare(b.term))
    .slice(0, limit);
}
