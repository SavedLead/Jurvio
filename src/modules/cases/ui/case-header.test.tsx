import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { displayCaption } from "@/modules/cases/domain/case-title";
import { splitCaseTypePrefix } from "@/modules/cases/domain/case-type-prefix";
import { CaseHeader } from "./case-header";

(globalThis as { React?: typeof React }).React = React;

describe("case header case-type badges", () => {
  it("badges a habeas caption after displayCaption has removed the court prefix", () => {
    const stored = "(HC) Cabrera Velasquez v. Mullin et al";
    const caption = displayCaption(stored, "1:26-cv-09467", "district");
    expect(caption).toBe("Cabrera Velasquez v. Mullin et al");
    const html = renderToStaticMarkup(
      <CaseHeader
        caseId="jv-yj1yaoy0ky"
        caption={caption}
        caseTypes={splitCaseTypePrefix(stored).types}
        courtName="Eastern District of California"
        docketNumber="1:26-cv-09467"
        filedOn="2026-11-17"
        showNavigation={false}
      />,
    );
    expect(html).toContain("Habeas corpus");
    expect(html).toContain("caseTypeBadge");
    expect(html).not.toContain("(HC)");
    expect(html).toContain("Cabrera Velasquez");
  });
});
