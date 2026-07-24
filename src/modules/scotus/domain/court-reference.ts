export interface Justice {
  name: string;
  role: "Chief Justice" | "Associate Justice";
  joined: string;
  appointingPresident: string;
}

export interface CourtMilestone {
  year: number;
  date?: string;
  title: string;
  description: string;
  category: "institution" | "membership" | "procedure" | "publication";
  importance: "major" | "context";
}

export const currentJustices: readonly Justice[] = [
  { name: "John G. Roberts, Jr.", role: "Chief Justice", joined: "September 29, 2005", appointingPresident: "George W. Bush" },
  { name: "Clarence Thomas", role: "Associate Justice", joined: "October 23, 1991", appointingPresident: "George H. W. Bush" },
  { name: "Samuel A. Alito, Jr.", role: "Associate Justice", joined: "January 31, 2006", appointingPresident: "George W. Bush" },
  { name: "Sonia Sotomayor", role: "Associate Justice", joined: "August 8, 2009", appointingPresident: "Barack Obama" },
  { name: "Elena Kagan", role: "Associate Justice", joined: "August 7, 2010", appointingPresident: "Barack Obama" },
  { name: "Neil M. Gorsuch", role: "Associate Justice", joined: "April 10, 2017", appointingPresident: "Donald J. Trump" },
  { name: "Brett M. Kavanaugh", role: "Associate Justice", joined: "October 6, 2018", appointingPresident: "Donald J. Trump" },
  { name: "Amy Coney Barrett", role: "Associate Justice", joined: "October 27, 2020", appointingPresident: "Donald J. Trump" },
  { name: "Ketanji Brown Jackson", role: "Associate Justice", joined: "June 30, 2022", appointingPresident: "Joseph R. Biden, Jr." },
] as const;

export const courtMilestones: readonly CourtMilestone[] = [
  { year: 1789, date: "September 24", title: "Judiciary Act creates the Court", description: "Congress establishes a Supreme Court with one Chief Justice and five Associate Justices.", category: "institution", importance: "major" },
  { year: 1790, date: "February 2", title: "The Court first convenes", description: "The Justices meet in New York City. The first session has no cases on the docket.", category: "institution", importance: "major" },
  { year: 1801, title: "Court briefly reduced to five seats", description: "The outgoing Congress provides that the next vacancy will reduce the Court, but the change is repealed before taking effect.", category: "membership", importance: "context" },
  { year: 1803, title: "Marbury v. Madison", description: "The Court articulates judicial review of federal legislation.", category: "procedure", importance: "major" },
  { year: 1807, title: "Seventh seat added", description: "Congress adds a seventh Justice as the federal judicial system expands.", category: "membership", importance: "context" },
  { year: 1837, title: "Court expands to nine", description: "Congress adds two seats to match the growth of federal judicial circuits.", category: "membership", importance: "major" },
  { year: 1863, title: "Tenth seat added", description: "The Court reaches its largest size, with ten authorized seats.", category: "membership", importance: "context" },
  { year: 1866, title: "Congress plans a seven-seat Court", description: "The Judicial Circuits Act provides that vacancies will reduce the Court, though it never falls below eight sitting Justices.", category: "membership", importance: "context" },
  { year: 1869, title: "Nine seats fixed", description: "The Circuit Judges Act sets the Court at one Chief Justice and eight Associate Justices, its present size.", category: "membership", importance: "major" },
  { year: 1891, title: "Circuit courts of appeals created", description: "The Evarts Act creates intermediate appellate courts and gives the Supreme Court greater control over its docket.", category: "procedure", importance: "major" },
  { year: 1925, title: "Judges’ Bill expands certiorari", description: "Congress sharply increases the Court’s discretion to choose which cases it reviews.", category: "procedure", importance: "major" },
  { year: 1935, date: "October 7", title: "The Supreme Court Building opens", description: "The Court sits for the first time in its own permanent building.", category: "institution", importance: "context" },
  { year: 1988, title: "Mostly discretionary docket", description: "Congress eliminates most remaining categories of mandatory Supreme Court appeals.", category: "procedure", importance: "major" },
  { year: 2000, title: "Same-day transcripts begin", description: "The Court’s modern online transcript archive begins with October Term 2000.", category: "publication", importance: "context" },
  { year: 2010, title: "Argument audio moves online", description: "The Court begins posting argument audio on its website at the end of each argument week.", category: "publication", importance: "context" },
] as const;

export const officialScotusLinks = [
  ["Docket search", "https://www.supremecourt.gov/docket/docket.aspx"],
  ["Argument calendars", "https://www.supremecourt.gov/oral_arguments/calendarsandlists.aspx"],
  ["Granted and noted list", "https://www.supremecourt.gov/orders/grantednotedlists.aspx"],
  ["Orders of the Court", "https://www.supremecourt.gov/orders/ordersofthecourt.aspx"],
  ["Opinions of the Court", "https://www.supremecourt.gov/opinions/slipopinion/25"],
  ["Argument transcripts", "https://www.supremecourt.gov/oral_arguments/argument_transcript.aspx"],
  ["Argument audio", "https://www.supremecourt.gov/oral_arguments/argument_audio.aspx"],
] as const;
