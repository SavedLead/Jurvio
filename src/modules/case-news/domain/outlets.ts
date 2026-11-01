// Outlet names for the domains we expect, and the allowlist of established news
// and legal-news publishers. A match from any other domain is capped below the
// publish threshold and goes to the review queue instead.

const OUTLETS: Record<string, string> = {
  "reuters.com": "Reuters", "apnews.com": "AP News", "courthousenews.com": "Courthouse News Service",
  "nytimes.com": "The New York Times", "washingtonpost.com": "The Washington Post", "wsj.com": "The Wall Street Journal",
  "bloomberg.com": "Bloomberg", "news.bloomberglaw.com": "Bloomberg Law", "bloomberglaw.com": "Bloomberg Law",
  "law.com": "Law.com", "law360.com": "Law360", "abajournal.com": "ABA Journal", "scotusblog.com": "SCOTUSblog",
  "npr.org": "NPR", "cnn.com": "CNN", "nbcnews.com": "NBC News", "cbsnews.com": "CBS News", "abcnews.go.com": "ABC News",
  "foxnews.com": "Fox News", "politico.com": "Politico", "axios.com": "Axios", "thehill.com": "The Hill",
  "usatoday.com": "USA Today", "latimes.com": "Los Angeles Times", "chicagotribune.com": "Chicago Tribune",
  "bostonglobe.com": "The Boston Globe", "theguardian.com": "The Guardian", "ft.com": "Financial Times",
  "cnbc.com": "CNBC", "forbes.com": "Forbes", "fortune.com": "Fortune", "businessinsider.com": "Business Insider",
  "theverge.com": "The Verge", "arstechnica.com": "Ars Technica", "techcrunch.com": "TechCrunch", "wired.com": "Wired",
  "statnews.com": "STAT", "propublica.org": "ProPublica", "lawfaremedia.org": "Lawfare", "justsecurity.org": "Just Security",
  "nationalreview.com": "National Review", "newsweek.com": "Newsweek", "time.com": "TIME", "vox.com": "Vox",
  "slate.com": "Slate", "theatlantic.com": "The Atlantic", "msnbc.com": "MSNBC", "pbs.org": "PBS",
  "texastribune.org": "The Texas Tribune", "sfchronicle.com": "San Francisco Chronicle", "seattletimes.com": "The Seattle Times",
  "miamiherald.com": "Miami Herald", "ajc.com": "The Atlanta Journal-Constitution", "dallasnews.com": "The Dallas Morning News",
  "houstonchronicle.com": "Houston Chronicle", "denverpost.com": "The Denver Post", "startribune.com": "Star Tribune",
  "inquirer.com": "The Philadelphia Inquirer", "nypost.com": "New York Post", "nydailynews.com": "New York Daily News",
  "jdsupra.com": "JD Supra", "news.justia.com": "Justia", "verdict.justia.com": "Justia Verdict",
  "democracydocket.com": "Democracy Docket", "insurancejournal.com": "Insurance Journal", "fiercepharma.com": "Fierce Pharma",
  "investmentnews.com": "InvestmentNews", "thinkadvisor.com": "ThinkAdvisor", "courtwatch.news": "Court Watch",
  "nationallawjournal.com": "The National Law Journal", "americanlawyer.com": "The American Lawyer",
  "ipwatchdog.com": "IPWatchdog", "news.bloombergtax.com": "Bloomberg Tax", "eenews.net": "E&E News",
  "governing.com": "Governing", "route-fifty.com": "Route Fifty", "federalnewsnetwork.com": "Federal News Network",
  "govexec.com": "Government Executive", "militarytimes.com": "Military Times", "abc7.com": "ABC7",
  "justice.gov": "U.S. Department of Justice", "sec.gov": "U.S. Securities and Exchange Commission", "ftc.gov": "Federal Trade Commission",
};

export function outletDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^(?:www|amp|m|mobile)\./, "");
  } catch {
    return "";
  }
}

function knownDomain(domain: string): string | null {
  if (OUTLETS[domain]) return domain;
  const parts = domain.split(".");
  for (let i = 1; i < parts.length - 1; i += 1) {
    const parent = parts.slice(i).join(".");
    if (OUTLETS[parent]) return parent;
  }
  return null;
}

export function outletName(domain: string): string {
  const known = knownDomain(domain);
  return known ? OUTLETS[known]! : domain;
}

export function isEstablishedOutlet(domain: string): boolean {
  return knownDomain(domain) !== null;
}
