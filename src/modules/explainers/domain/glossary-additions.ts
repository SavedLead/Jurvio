import type { GlossaryTerm } from "./glossary";

export const glossaryAdditions: readonly GlossaryTerm[] = [
  {
    term: "Ultra vires",
    definition: "An act taken beyond the legal authority or powers granted to a government body, official, corporation, or other entity.",
    stage: "motions",
    jurisdiction: "general",
    domains: ["administrative", "constitutional", "business"],
    popularity: 3,
    aliases: ["beyond authority", "beyond legal power"],
  },
  // Party labels and outcome words that appear on appellate case pages.
  {
    term: "Appellant",
    definition: "The party that appeals, asking a higher court to change a lower court's decision.",
    stage: "appeal",
    jurisdiction: "general",
    domains: ["appellate", "civil", "criminal"],
    popularity: 4,
    aliases: ["appellants"],
  },
  {
    term: "Appellee",
    definition: "The party on the other side of an appeal, usually the side that won in the lower court.",
    stage: "appeal",
    jurisdiction: "general",
    domains: ["appellate", "civil", "criminal"],
    popularity: 4,
    aliases: ["appellees"],
  },
  {
    term: "Overruled",
    definition: "A higher or later court declared that an earlier decision is no longer good law. At trial, an overruled objection is one the judge rejected.",
    stage: "appeal",
    jurisdiction: "general",
    domains: ["appellate", "constitutional"],
    popularity: 3,
  },
  {
    term: "Unpublished opinion",
    definition: "A decision the court marked as non-precedential: it resolves this case but generally does not bind future cases.",
    stage: "appeal",
    jurisdiction: "general",
    domains: ["appellate"],
    popularity: 3,
    aliases: ["non-precedential opinion", "nonprecedential opinion", "not precedential"],
  },
  {
    term: "Pro hac vice",
    definition: "Permission for a lawyer who is not admitted in this court to appear for one particular case.",
    stage: "starting a case",
    jurisdiction: "general",
    domains: ["civil", "criminal"],
    popularity: 2,
  },
];
