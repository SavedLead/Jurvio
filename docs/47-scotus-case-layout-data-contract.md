# SCOTUS case-layout data contract

This document defines verified, conditional inputs needed by the public SCOTUS case workspace. Missing values never create empty public sections. Ingestion remains responsible for source acquisition, normalization, reconciliation, and verification.

## Universal rules

Every public field requires a source artifact or official source URL, source identifier, retrieval timestamp, verification state, and last verified timestamp. Text derived from a court document must retain the document identifier and page or structural locator when available. Internal approval, moderation, queue, held, retry, and operational-error fields are never public.

## Conditional feature inputs

| ID | Required verified inputs |
|---|---|
| B | Question text; source document ID; source locator; verification timestamp |
| D | Decision vote; participating justices; joins; recusals/nonparticipation; opinion author; separate-opinion relationships; official source |
| E/L | Event date; event type; court; lower-court docket and citation; description; source document or docket entry; sequence; completeness boundary |
| F | Document ID; normalized type; title; filed date; court; official URL; readable-content state; version/revision relationship; checksum; verification timestamp; collection-completeness flag scoped to a defined source set |
| G | Argument date; transcript document; audio URL; duration; speakers when verified; official source |
| I | U.S. Reports volume/page; slip-opinion pagination map; paragraph/section anchors; source version and revision date |
| J | Provision type; title; citation; quoted or referenced locator; relationship to question, argument, or holding |
| K | Exact court passage; opinion type; author; page/paragraph locator; editorial reason; verification source |
| M | Advocate name; represented party; role; argument date; verified identity; official case or transcript source |
| N | Related case ID; relationship type; direction; citation; treatment; source locator; verification timestamp |
| U | Supreme Court term; official citation; decision date; opinion type; author; per-curiam flag; disposition; source |
| V | Topic/classification ID; neutral label; controlling source or reviewed classification method; verification timestamp |

## Document completeness

The current public corpus has one readable official opinion for each published SCOTUS case. The interface must say “Documents currently available,” not “Complete document library.” A completeness claim requires an explicit, source-scoped completeness record covering the expected document categories and checked source window.

## Caption normalization

Ingestion should store the official caption separately from revision notices. Revision dates, preliminary-print labels, corrected-copy labels, and Reporter publication notes belong to document-version metadata, not the case caption.
