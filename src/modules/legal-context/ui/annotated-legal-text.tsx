"use client";

import { useEffect, useRef } from "react";
import type { CitedCaseContext } from "../domain/legal-context";
import { hasSourceBackedCaseContext } from "../domain/legal-context";
import type { PlainTerm } from "@/modules/plain-english/domain/term-index";
import styles from "./annotated-legal-text.module.css";

interface AnnotatedLegalTextProps {
  html: string;
  /** Dictionary terms present in this text (server-filtered, see termsInText). */
  terms: readonly PlainTerm[];
  /** [lower-case label, term key, exact-case form for acronyms] for those terms. */
  labels: ReadonlyArray<readonly [string, string, string?]>;
  citations?: readonly CitedCaseContext[];
  className?: string;
}

// Never mark inside links, headings, citations, code, or existing term markup.
const SKIP_SELECTOR = "a,button,code,pre,script,style,textarea,sup,h1,h2,h3,h4,h5,h6,.jurvioCitationPending,.jurvioCaseCitation,.ptTerm";
const HEADING = /^H[1-6]$/;

/**
 * Opinion text with dictionary-term cards (same .ptTerm markup and behavior as
 * server-marked text). Runs after hydration so it never delays the first paint;
 * each term is marked at its first mention per heading-delimited section.
 */
export function AnnotatedLegalText({ html, terms, labels, citations = [], className }: AnnotatedLegalTextProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const termByKey = new Map(terms.map((term) => [term.key, term]));
    const keyByLabel = new Map<string, string>();
    const exactByLabel = new Map<string, string>();
    for (const [label, key, exact] of labels) {
      if (!termByKey.has(key)) continue;
      keyByLabel.set(label, key);
      if (exact) exactByLabel.set(label, exact);
    }
    const citationByLabel = new Map(citations.map((citation) => [citation.citation.toLowerCase(), citation]));
    const all = [...keyByLabel.keys(), ...citationByLabel.keys()].sort((a, b) => b.length - a.length);
    if (all.length === 0) return;
    const expression = new RegExp(
      `(?<![\\p{L}\\p{N}\\-])(?:${all.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}\\-])`, "giu");

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    const work: Array<{ node: Text; section: number }> = [];
    let section = 0;
    while (walker.nextNode()) {
      const current = walker.currentNode;
      if (current instanceof Element) {
        if (HEADING.test(current.tagName)) section += 1;
        continue;
      }
      const node = current as Text;
      if (!node.data.trim() || node.parentElement?.closest(SKIP_SELECTOR)) continue;
      work.push({ node, section });
    }
    const seen = new Map<number, Set<string>>();
    for (const { node, section: index } of work) {
      const marked = seen.get(index) ?? new Set<string>();
      seen.set(index, marked);
      annotateNode(node, expression, (label) => {
        const lower = label.toLowerCase().replace(/\s+/g, " ");
        const key = keyByLabel.get(lower);
        if (key) {
          if (marked.has(key)) return null;
          if (exactByLabel.has(lower) && exactByLabel.get(lower) !== label) return null;
          marked.add(key);
          return createTerm(label, termByKey.get(key)!, `pto-${index}-${key}`);
        }
        const citation = citationByLabel.get(lower);
        return citation ? createCitation(label, citation) : null;
      });
    }
  }, [citations, labels, terms]);

  return <div ref={rootRef} className={[styles.root, className].filter(Boolean).join(" ")}
    dangerouslySetInnerHTML={{ __html: html }} />;
}

function annotateNode(node: Text, expression: RegExp, build: (label: string) => Node | null) {
  const text = node.data;
  let fragment: DocumentFragment | null = null;
  let cursor = 0;
  for (const match of text.matchAll(expression)) {
    const replacement = build(match[0]);
    if (!replacement) continue;
    fragment ??= document.createDocumentFragment();
    const index = match.index ?? 0;
    fragment.append(text.slice(cursor, index), replacement);
    cursor = index + match[0].length;
  }
  if (!fragment) return;
  fragment.append(text.slice(cursor));
  node.replaceWith(fragment);
}

function createTerm(text: string, term: PlainTerm, id: string): HTMLElement {
  const wrapper = document.createElement("span");
  wrapper.className = "ptTerm";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "ptTrigger";
  trigger.setAttribute("aria-describedby", id);
  trigger.setAttribute("aria-controls", id);
  trigger.setAttribute("aria-expanded", "false");
  trigger.textContent = text;
  const card = document.createElement("span");
  card.className = "ptCard";
  card.id = id;
  card.setAttribute("role", "tooltip");
  card.setAttribute("data-nosnippet", "");
  const title = document.createElement("strong");
  title.className = "ptCardTerm";
  title.textContent = term.term;
  const definition = document.createElement("span");
  definition.className = "ptCardDef";
  definition.textContent = term.definition;
  const link = document.createElement("a");
  link.className = "ptCardLink";
  link.href = term.href;
  link.append("Learn more");
  const hidden = document.createElement("span");
  hidden.className = "ptSrOnly";
  hidden.textContent = ` about ${term.term.toLowerCase()}`;
  link.append(hidden, " →");
  card.append(title, definition, link);
  wrapper.append(trigger, card);
  return wrapper;
}

function createCitation(text: string, context: CitedCaseContext): HTMLElement {
  const link = document.createElement("a");
  link.href = context.href;
  link.textContent = text;
  if (!hasSourceBackedCaseContext(context)) return link;
  link.className = "jurvioCitationContext";
  const card = document.createElement("span");
  card.className = "jurvioContextCard";
  card.setAttribute("role", "tooltip");
  const title = document.createElement("strong");
  title.textContent = context.caseName ?? context.citation;
  const metadata = document.createElement("span");
  metadata.textContent = [context.court, context.filedOn].filter(Boolean).join(" · ");
  const relevance = document.createElement("span");
  relevance.textContent = context.relevance ?? "";
  const source = document.createElement("a");
  source.href = context.sourceHref ?? context.href;
  source.textContent = "View supporting source";
  card.append(title, metadata, relevance, source);
  link.append(card);
  return link;
}

function escapeRegExp(value: string) {
  return value.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&").replace(/\s+/g, "\\s+");
}
