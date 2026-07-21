interface CaseFaqProps {
  caption: string;
  courtName: string;
  docketNumber: string;
  filedOn: string | null;
  status: string;
}

export function CaseFaq({
  caption,
  courtName,
  docketNumber,
  filedOn,
  status,
}: CaseFaqProps) {
  const questions = [
    ["What is " + caption + "?", "It is a public court case filed in " + courtName + "."],
    ["What is the docket number for " + caption + "?", docketNumber],
    ["When was " + caption + " filed?", filedOn ?? "The filing date is not available in the verified public record."],
    ["What is the current status of " + caption + "?", status],
  ] as const;

  return (
    <section className="faqSection" aria-labelledby="case-questions">
      <p className="sectionKicker">Quick answers</p>
      <h2 id="case-questions">Frequently asked questions about this case</h2>
      <div className="faqList">
        {questions.map(([question, answer]) => (
          <details key={question}>
            <summary>{question}</summary>
            <p>{answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
