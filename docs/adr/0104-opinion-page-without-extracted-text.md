# Opinion pages open without extracted text

Status: Accepted for the Supreme Court hub links that 404ed on 2026-11-09.

## Context

`/supreme-court` linked 24 recent opinions to `/case/<id>/documents/<id>`. Seven of those pages returned 404. The case pages returned 200. The reader query inner-joined `document_content`, so a published opinion with an official PDF and no extracted text did not exist as a page.

## Decision

The reader loads a published, displayable opinion even when `document_content` is missing. The page shows the metadata, an "Official PDF" link, and an embedded PDF when the URL is an https PDF on supremecourt.gov, loc.gov, govinfo.gov, or uscourts.gov. A page with no extracted text is `noindex`.

On `/supreme-court`, each opinion is one card. The case name links to `/case/<id>`. The opinion page is a second link, and only with a well-formed document id. The Court's PDF stays a small source link. A slip-index row that shares a docket and PDF with a published opinion is not listed again. Feeds link the opinion to the case page.

## Alternatives

- Drop the opinion links until text extraction finishes. Rejected: the case is published and the Court PDF is already the record.
- Extract text inside the page request. Rejected: that downloads a PDF on the public web server.

## Benefits

The seven hub links open. A crawl can reject an internal opinion href whose id the reader would not accept.

## Costs and risks

A thin page can be opened before text extraction. It is not indexed. Embedding depends on the Court sending the PDF without a frame block.

## Reconsideration trigger

Revisit if the Court starts blocking embeds, or if opinion pages without text become a large share of indexed URLs.
