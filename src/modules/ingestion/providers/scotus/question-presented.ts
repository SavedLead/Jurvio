/**
 * The questions a Supreme Court petition asked the Court to decide, from the
 * Court's own "questions presented" PDF (supremecourt.gov/qp/YY-NNNNNqp.pdf,
 * linked from the docket page once review is granted). Text comes from
 * pdftotext on the builder; this module only parses it. Nothing is rewritten:
 * each question is kept in the petition's words.
 */
export const QUESTION_PRESENTED_PARSER_VERSION = "scotus-qp-v1";

/** The QP link on a docket page ("../qp/22-00451qp.pdf"), as an absolute supremecourt.gov URL. */
export function readQuestionsPresentedUrl(html: string): string | null {
  const match = /href\s*=\s*["']([^"']*\/qp\/\d{2}-?[0-9A-Z]{1,6}qp\.pdf)["']/i.exec(html);
  if (!match?.[1]) return null;
  const path = match[1].replace(/^(?:\.\.\/)+/, "/").replace(/^https?:\/\/www\.supremecourt\.gov/i, "");
  if (!/^\/qp\/[0-9A-Za-z-]+qp\.pdf$/.test(path)) return null;
  return `https://www.supremecourt.gov${path}`;
}

/** The Court's standard QP path for a paid or in-forma-pauperis docket ("12-398" -> /qp/12-00398qp.pdf); the 2000-2016 archive pages don't link it. */
export function questionsPresentedUrlFor(docketNumber: string): string | null {
  const match = /^(\d{2})-(\d{1,5})$/.exec(docketNumber.trim());
  if (!match?.[1] || !match[2]) return null;
  return `https://www.supremecourt.gov/qp/${match[1]}-${match[2].padStart(5, "0")}qp.pdf`;
}

export interface ParsedQuestionsPresented {
  questions: string[];
  grantedLimitedTo: number[] | null;
  /** "GRANTED LIMITED TO THE FOLLOWING QUESTION: …" — the Court's own rewording, verbatim. */
  grantedQuestion: string | null;
}

const MAX_QUESTION = 1200;

function flow(text: string) {
  return text
    .replace(/\r/g, "")
    .replace(/-\n(?=[a-z])/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse pdftotext output of a questions-presented PDF. Numbered questions
 * ("1. Whether …") are split; otherwise the text after "The question presented
 * is:" is one question. Returns null when no question can be read.
 */
export function parseQuestionsPresented(text: string): ParsedQuestionsPresented | null {
  const body = text.replace(/\f/g, "\n").replace(/\r/g, "");
  const start = /QUESTIONS?\s+PRESENTED\s*:?/i.exec(body);
  if (!start) return null;
  let section = body.slice(start.index + start[0].length);
  // The questions end where the clerk's notes begin (grant, orders, consolidation, limits).
  const end = section.search(/\n\s*(?:THE\s+PETITION\s+FOR|(?:CERT\.|CERTIORARI)\s+GRANTED|LOWER\s+COURT\s+CASE\s+NUMBER|JUSTICE\s+[A-Z]+\s+TOOK\s+NO\s+PART|ORDER\s+OF\s+[A-Z]+|CONSOLIDATED\s+WITH|(?:GRANTED\s+)?LIMITED\s+TO\s+|THE\s+CASE\s+IS\s+SET|THE\s+MOTION\s+OF|THE\s+SOLICITOR\s+GENERAL)/);
  if (end > 0) section = section.slice(0, end);
  // Prefer the sentence that introduces the questions; the paragraphs before it are the petition's framing.
  const intro = /\b(?:The\s+questions?\s+presented\s+(?:is|are)|presents?\s+the\s+following\s+questions?|questions?\s+(?:is|are)\s+presented)\s*:?/i.exec(section);
  const tail = intro ? section.slice(intro.index + intro[0].length) : section;
  // Numbered questions start a line with "1.", "2.", … in order.
  const parts = tail.split(/\n[ \t]*(?=\d{1,2}\.\s)/);
  const numbered: string[] = [];
  for (const part of parts) {
    const match = /^(\d{1,2})\.\s+/.exec(part);
    if (match && Number(match[1]) === numbered.length + 1) numbered.push(flow(part.slice(match[0].length)));
    else if (numbered.length) numbered[numbered.length - 1] += ` ${flow(part)}`;
  }
  let questions = numbered.length >= 2 ? numbered.filter((part) => part.length >= 10) : [];
  if (questions.length < 2) {
    const single = flow(tail).replace(/^1\.\s+/, "");
    questions = single.length >= 15 ? [single] : [];
  }
  questions = questions.map((question) => question.length > MAX_QUESTION ? `${question.slice(0, MAX_QUESTION - 1).replace(/\s+\S*$/, "")}…` : question).slice(0, 8);
  if (questions.length === 0) return null;
  const limited = /LIMITED\s+TO\s+QUESTIONS?\s+(\d{1,2}(?:\s*(?:,|AND|&)\s*\d{1,2})*)/i.exec(body);
  const grantedLimitedTo = limited?.[1]
    ? [...limited[1].matchAll(/\d+/g)].map((match) => Number(match[0])).filter((number) => number >= 1 && number <= questions.length)
    : null;
  const reworded = /LIMITED\s+TO\s+THE\s+FOLLOWING\s+QUESTIONS?\s*:\s*([\s\S]{10,1500}?)(?:\n\s*(?:CERT\.|CERTIORARI|ORDER\s+OF|JUSTICE\s+[A-Z]+\s+TOOK|CONSOLIDATED|THE\s+CASE\s+IS)|$)/i.exec(body);
  return {
    questions,
    grantedLimitedTo: grantedLimitedTo?.length ? grantedLimitedTo : null,
    grantedQuestion: reworded?.[1] ? flow(reworded[1]).slice(0, MAX_QUESTION) : null,
  };
}
