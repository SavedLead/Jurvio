export type AppellateAdapterType = "official-html-pdf-v1";

export interface AppellateCourtSource {
  code: string;
  name: string;
  circuit: string;
  courtListenerCode: string;
  officialWebsite: string;
  opinionsUrl: string;
  historicalUrl: string;
  rssUrl: string | null;
  calendarUrl: string | null;
  audioUrl: string | null;
  timeZone: string;
  adapterType: AppellateAdapterType;
  enabled: boolean;
}

export const APPELLATE_COURT_REGISTRY: readonly AppellateCourtSource[] = [
  { code:"ca1", name:"United States Court of Appeals for the First Circuit", circuit:"1", courtListenerCode:"ca1", officialWebsite:"https://www.ca1.uscourts.gov", opinionsUrl:"https://www.ca1.uscourts.gov/opn", historicalUrl:"https://www.ca1.uscourts.gov/opn", rssUrl:"https://www.ca1.uscourts.gov/rss/opinions", calendarUrl:"https://www.ca1.uscourts.gov/calendar", audioUrl:"https://www.ca1.uscourts.gov/oralargs", timeZone:"America/New_York", adapterType:"official-html-pdf-v1", enabled:true },
  { code:"ca2", name:"United States Court of Appeals for the Second Circuit", circuit:"2", courtListenerCode:"ca2", officialWebsite:"https://www.ca2.uscourts.gov", opinionsUrl:"https://www.ca2.uscourts.gov/decisions.html", historicalUrl:"https://www.ca2.uscourts.gov/decisions.html", rssUrl:"https://www.ca2.uscourts.gov/nav/rss.html", calendarUrl:"https://www.ca2.uscourts.gov/calendars.html", audioUrl:"https://www.ca2.uscourts.gov/decisions.html", timeZone:"America/New_York", adapterType:"official-html-pdf-v1", enabled:true },
  { code:"ca3", name:"United States Court of Appeals for the Third Circuit", circuit:"3", courtListenerCode:"ca3", officialWebsite:"https://www.ca3.uscourts.gov", opinionsUrl:"https://www2.ca3.uscourts.gov/recentop/week/recprec.htm", historicalUrl:"https://www.ca3.uscourts.gov/opinions-and-oral-arguments", rssUrl:"https://www2.ca3.uscourts.gov/rss/recentopinions.xml", calendarUrl:"https://www.ca3.uscourts.gov/oral-argument-calendars", audioUrl:"https://www.ca3.uscourts.gov/oral-argument-recordings", timeZone:"America/New_York", adapterType:"official-html-pdf-v1", enabled:true },
  { code:"ca4", name:"United States Court of Appeals for the Fourth Circuit", circuit:"4", courtListenerCode:"ca4", officialWebsite:"https://www.ca4.uscourts.gov", opinionsUrl:"https://www.ca4.uscourts.gov/opinions/daily-opinions", historicalUrl:"https://www.ca4.uscourts.gov/opinions/search-opinions", rssUrl:"https://www.ca4.uscourts.gov/RSS/RSSFeed.ashx?type=Opinions", calendarUrl:"https://www.ca4.uscourts.gov/oral-argument/oral-argument-calendar", audioUrl:"https://www.ca4.uscourts.gov/oral-argument/listen-to-oral-arguments", timeZone:"America/New_York", adapterType:"official-html-pdf-v1", enabled:true },
  { code:"ca5", name:"United States Court of Appeals for the Fifth Circuit", circuit:"5", courtListenerCode:"ca5", officialWebsite:"https://www.ca5.uscourts.gov", opinionsUrl:"https://www.ca5.uscourts.gov/opinions", historicalUrl:"https://www.ca5.uscourts.gov/opinions", rssUrl:null, calendarUrl:"https://www.ca5.uscourts.gov/oral-argument-information", audioUrl:"https://www.ca5.uscourts.gov/oral-argument-information/oral-argument-recordings", timeZone:"America/Chicago", adapterType:"official-html-pdf-v1", enabled:true },
  { code:"ca6", name:"United States Court of Appeals for the Sixth Circuit", circuit:"6", courtListenerCode:"ca6", officialWebsite:"https://www.ca6.uscourts.gov", opinionsUrl:"https://www.opn.ca6.uscourts.gov/opinions.pdf", historicalUrl:"https://www.ca6.uscourts.gov/opinions", rssUrl:null, calendarUrl:"https://www.ca6.uscourts.gov/court-calendar", audioUrl:"https://www.ca6.uscourts.gov/oral-argument-audio-files", timeZone:"America/New_York", adapterType:"official-html-pdf-v1", enabled:true },
  { code:"ca7", name:"United States Court of Appeals for the Seventh Circuit", circuit:"7", courtListenerCode:"ca7", officialWebsite:"https://www.ca7.uscourts.gov", opinionsUrl:"https://media.ca7.uscourts.gov/cgi-bin/rssExec.pl?Submit=Display&Path=Y2026/D07-30/C:25-0000:J:0:aut:T:fnOp:N:0:S:0", historicalUrl:"https://www.ca7.uscourts.gov/opinions.htm", rssUrl:"https://media.ca7.uscourts.gov/cgi-bin/rssExec.pl?Time=month&FromMonth=01&FromYear=2026&ToMonth=12&ToYear=2026&Author=any&AuthorName=&Case=any&CaseName=&CaseNumber=&RssJudgeName=S&OpsOnly=no", calendarUrl:"https://www.ca7.uscourts.gov/cal/argcalendar.pdf", audioUrl:"https://media.ca7.uscourts.gov/oralArguments/oar.jsp", timeZone:"America/Chicago", adapterType:"official-html-pdf-v1", enabled:true },
  { code:"ca8", name:"United States Court of Appeals for the Eighth Circuit", circuit:"8", courtListenerCode:"ca8", officialWebsite:"https://www.ca8.uscourts.gov", opinionsUrl:"https://ecf.ca8.uscourts.gov/cgi-bin/opnByDate.pl", historicalUrl:"https://www.ca8.uscourts.gov/opinions", rssUrl:null, calendarUrl:"https://www.ca8.uscourts.gov/oral-argument-calendars", audioUrl:"https://www.ca8.uscourts.gov/oral-argument-recordings", timeZone:"America/Chicago", adapterType:"official-html-pdf-v1", enabled:true },
  { code:"ca9", name:"United States Court of Appeals for the Ninth Circuit", circuit:"9", courtListenerCode:"ca9", officialWebsite:"https://www.ca9.uscourts.gov", opinionsUrl:"https://www.ca9.uscourts.gov/opinions/", historicalUrl:"https://www.ca9.uscourts.gov/opinions/", rssUrl:"https://cdn.ca9.uscourts.gov/datastore/opinions/rss.xml", calendarUrl:"https://www.ca9.uscourts.gov/calendar/", audioUrl:"https://www.ca9.uscourts.gov/media/", timeZone:"America/Los_Angeles", adapterType:"official-html-pdf-v1", enabled:true },
  { code:"ca10", name:"United States Court of Appeals for the Tenth Circuit", circuit:"10", courtListenerCode:"ca10", officialWebsite:"https://www.ca10.uscourts.gov", opinionsUrl:"https://www.ca10.uscourts.gov/opinions", historicalUrl:"https://www.ca10.uscourts.gov/opinions", rssUrl:null, calendarUrl:"https://www.ca10.uscourts.gov/oral-argument-calendar", audioUrl:"https://www.ca10.uscourts.gov/oral-argument-recordings", timeZone:"America/Denver", adapterType:"official-html-pdf-v1", enabled:true },
  { code:"ca11", name:"United States Court of Appeals for the Eleventh Circuit", circuit:"11", courtListenerCode:"ca11", officialWebsite:"https://www.ca11.uscourts.gov", opinionsUrl:"https://media.ca11.uscourts.gov/opinions/pub.php", historicalUrl:"https://media.ca11.uscourts.gov/opinions", rssUrl:null, calendarUrl:"https://www.ca11.uscourts.gov/oral-argument-calendars", audioUrl:"https://www.ca11.uscourts.gov/oral-argument-recordings", timeZone:"America/New_York", adapterType:"official-html-pdf-v1", enabled:true },
  { code:"cadc", name:"United States Court of Appeals for the District of Columbia Circuit", circuit:"DC", courtListenerCode:"cadc", officialWebsite:"https://www.cadc.uscourts.gov", opinionsUrl:"https://media.cadc.uscourts.gov/opinions/bydate.asp", historicalUrl:"https://media.cadc.uscourts.gov/opinions/", rssUrl:null, calendarUrl:"https://www.cadc.uscourts.gov/internet/home.nsf/Content/VL+-+RPP+-+Oral+Argument+Calendar", audioUrl:"https://media.cadc.uscourts.gov/recordings/", timeZone:"America/New_York", adapterType:"official-html-pdf-v1", enabled:true },
  { code:"cafc", name:"United States Court of Appeals for the Federal Circuit", circuit:"Federal", courtListenerCode:"cafc", officialWebsite:"https://www.cafc.uscourts.gov", opinionsUrl:"https://www.cafc.uscourts.gov/home/case-information/opinions-orders/", historicalUrl:"https://www.cafc.uscourts.gov/home/case-information/opinions-orders/", rssUrl:"https://www.cafc.uscourts.gov/category/opinions-orders/feed/", calendarUrl:"https://www.cafc.uscourts.gov/home/oral-argument/calendar-of-sessions/", audioUrl:"https://oralarguments.cafc.uscourts.gov/", timeZone:"America/New_York", adapterType:"official-html-pdf-v1", enabled:true },
] as const;

export function appellateCourtByCode(code:string): AppellateCourtSource | null {
  return APPELLATE_COURT_REGISTRY.find(c=>c.code===code.trim().toLowerCase()) ?? null;
}

export function fairAppellateOrder(checkpoints: ReadonlyMap<string,string|null>): AppellateCourtSource[] {
  return [...APPELLATE_COURT_REGISTRY].filter(c=>c.enabled).sort((a,b)=>{
    const av=checkpoints.get(a.code), bv=checkpoints.get(b.code);
    if (av===bv) return a.code.localeCompare(b.code);
    if (av===null || av===undefined) return -1;
    if (bv===null || bv===undefined) return 1;
    return av.localeCompare(bv);
  });
}
