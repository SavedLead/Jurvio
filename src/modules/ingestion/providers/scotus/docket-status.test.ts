import { describe, expect, it } from "vitest";
import { officialDocketPageUrl, parseDocketStatus, readDocketStatus } from "./docket-status";

// Trimmed shapes of the two official page formats (no attorney blocks).
const OLD_FORMAT = `<html><body><TABLE><TR><TD>No. 05-1256</TD></TR>
<TR><TD>Title:</TD>
<TD>
<Table border=0><TR><TD>Philip Morris USA, Petitioner</TD></TR>
<TR><TD> v.</TD></TR>
<TR><TD> Mayola Williams, Personal Representative of the Estate of Jesse D. Williams, Deceased</TD></TR>
</Table>
</TD></TR>
<TR><TD>Docketed:</TD><TD>March 31, 2006</TD></TR>
<TR><TD>Lower Ct:</TD><TD>Supreme Court of Oregon</TD></TR>
</TABLE>
<TABLE><TR><TD>&nbsp;&nbsp;Case Nos.:</TD><TD align=left>(S51805)</TD></TR>
<TR><TD>&nbsp;&nbsp;Decision Date:</TD><TD>February 2, 2006</TD></TR></TABLE>
<TABLE BORDER=0>
<TR><TD>~~Date~~~~~~&nbsp;&nbsp;&nbsp;</TD><TD>~~~~~~~Proceedings&nbsp;and&nbsp;Orders~~~~~~</TD></TR>
<TR><TD>Mar 30 2006</TD><TD>Petition for a writ of certiorari filed. (Response due May 1, 2006)</TD></TR>
<TR><TD>May 30 2006</TD><TD>Petition GRANTED limited to Questions 1 and 2 presented by the petition.</TD></TR>
<TR><TD>Feb 20 2007</TD><TD>Judgment VACATED and case REMANDED. Breyer, J., delivered the opinion of the Court, in which Roberts, C. J., joined.</TD></TR>
<TR><TD>Mar 26 2007</TD><TD>MANDATE ISSUED.</TD></TR>
</TABLE></body></html>`;

const NEW_FORMAT = `<table><tr><td><span>Title:</span></td>
            <td>
                <span class="title">Jeffrey Lance Hill, Sr., Petitioner<br />
                        v. <br /> Leandra G. Johnson, et al.
                </span>
            </td></tr>
        <tr><td width="200"><span>Docketed:</span></td><td><span>February 7, 2020</span></td></tr>
        <tr><td width="200"><span>Lower Ct:</span></td><td><span>United States Court of Appeals for the Eleventh Circuit</span></td></tr>
        <tr><td><span>Decision Date:</span></td><td><span>September 20, 2019</span></td></tr></table>
<table id="proceedings">
<tr><td>Feb 03, 2020</td><td>Petition for a writ of certiorari and motion for leave to proceed in forma pauperis filed.</td></tr>
<tr><td>Mar 18, 2020</td><td>DISTRIBUTED for Conference of 4/3/2020.</td></tr>
<tr><td>Apr 06, 2020</td><td>Petition DENIED.</td></tr>
<tr><td>Jun 01, 2020</td><td>Rehearing DENIED.</td></tr>
</table>`;

const event = (filedOn: string, description: string) => ({ sourceRecordId: filedOn, filedOn, description, eventType: "other", documents: [] });

describe("official Supreme Court docket status", () => {
  it("builds the official page URL for 2000+ docket numbers only", () => {
    expect(officialDocketPageUrl("19-994")).toBe("https://www.supremecourt.gov/search.aspx?filename=/docket/docketfiles/html/public/19-994.html");
    expect(officialDocketPageUrl("05-1256")).toBe("https://www.supremecourt.gov/search.aspx?filename=/docketfiles/05-1256.htm");
    expect(officialDocketPageUrl("93-5256")).toBeNull();
    expect(officialDocketPageUrl("No. 105, Misc.")).toBeNull();
  });

  it("reads the 2000-2016 archive format: titles, lower court, grant and judgment", () => {
    const status = parseDocketStatus(OLD_FORMAT, "05-1256", "https://www.supremecourt.gov/x");
    expect(status).toMatchObject({
      petitionerTitle: "Philip Morris USA",
      respondentTitle: "Mayola Williams, Personal Representative of the Estate of Jesse D. Williams, Deceased",
      lowerCourt: "Supreme Court of Oregon",
      lowerCourtDecidedOn: "2006-02-02",
      certStatus: "granted",
      certStatusOn: "2006-05-30",
      judgmentOn: "2007-02-20",
      judgmentEntry: "Judgment VACATED and case REMANDED.",
    });
  });

  it("reads the 2017+ format: cert denied, rehearing denial is not the cert decision", () => {
    const status = parseDocketStatus(NEW_FORMAT, "19-994", "https://www.supremecourt.gov/x");
    expect(status).toMatchObject({
      petitionerTitle: "Jeffrey Lance Hill, Sr.",
      respondentTitle: "Leandra G. Johnson, et al.",
      certStatus: "denied",
      certStatusOn: "2020-04-06",
      certEntry: "Petition DENIED.",
      judgmentEntry: null,
      lastEntryOn: "2020-06-01",
    });
  });

  it("handles summary dispositions, dismissals and pending petitions", () => {
    expect(readDocketStatus([event("2010-01-11", "Petition GRANTED. Judgment VACATED and case REMANDED for further consideration in light of X v. Y.")]))
      .toMatchObject({ certStatus: "granted", judgmentEntry: "Petition GRANTED. Judgment VACATED and case REMANDED for further consideration in light of X v. Y." });
    expect(readDocketStatus([event("2012-03-01", "Petition DISMISSED - Rule 46.")])).toMatchObject({ certStatus: "dismissed" });
    expect(readDocketStatus([event("2009-05-18", "Motion of petitioner for leave to proceed in forma pauperis DENIED, and petition for writ of certiorari DISMISSED.")]))
      .toMatchObject({ certStatus: "dismissed" });
    expect(readDocketStatus([event("2026-10-01", "Petition for a writ of certiorari filed."), event("2026-10-20", "Motion to extend the time to file a response is granted.")]))
      .toMatchObject({ certStatus: "pending", judgmentEntry: null });
    expect(readDocketStatus([event("2015-06-29", "Judgment REVERSED and case REMANDED. Scalia, J., delivered the opinion of the Court.")]))
      .toMatchObject({ certStatus: "granted", judgmentEntry: "Judgment REVERSED and case REMANDED." });
  });
});
