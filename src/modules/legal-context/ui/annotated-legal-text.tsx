"use client";

import { useEffect, useRef } from "react";
import type { CitedCaseContext, LegalTermContext } from "../domain/legal-context";
import { hasSourceBackedCaseContext } from "../domain/legal-context";
import styles from "./annotated-legal-text.module.css";

interface AnnotatedLegalTextProps {
  html: string;
  terms: readonly LegalTermContext[];
  citations?: readonly CitedCaseContext[];
  className?: string;
}

const skippedParents = new Set(["A", "BUTTON", "CODE", "PRE", "SCRIPT", "STYLE", "TEXTAREA"]);

export function AnnotatedLegalText({ html, terms, citations = [], className }: AnnotatedLegalTextProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const patterns = buildPatterns(terms, citations);
    if (patterns.length === 0) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const parent = node.parentElement;
      if (parent && !parent.closest([...skippedParents].join(",")) && node.data.trim()) nodes.push(node);
    }
    nodes.forEach((node) => annotateNode(node, patterns));

    function dismissActiveCard(event: PointerEvent) {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !active.classList.contains("jurvioLegalTerm")) return;
      if (event.target instanceof Node && active.contains(event.target)) return;
      active.blur();
    }
    function dismissWithKeyboard(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.classList.contains("jurvioLegalTerm")) active.blur();
    }
    document.addEventListener("pointerdown", dismissActiveCard);
    document.addEventListener("keydown", dismissWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", dismissActiveCard);
      document.removeEventListener("keydown", dismissWithKeyboard);
    };
  }, [citations, terms]);

  return <div ref={rootRef} className={[styles.root, className].filter(Boolean).join(" ")}
    dangerouslySetInnerHTML={{ __html: html }} />;
}

type Pattern =
  | { kind: "term"; label: string; context: LegalTermContext }
  | { kind: "citation"; label: string; context: CitedCaseContext };

function buildPatterns(terms: readonly LegalTermContext[], citations: readonly CitedCaseContext[]): Pattern[] {
  const patterns: Pattern[] = [];
  for (const context of terms) {
    for (const label of [context.term, ...context.aliases]) patterns.push({ kind: "term", label, context });
  }
  for (const context of citations) patterns.push({ kind: "citation", label: context.citation, context });
  return patterns.sort((a, b) => b.label.length - a.label.length);
}

function annotateNode(node: Text, patterns: readonly Pattern[]) {
  const escaped = patterns.map((pattern) => escapeRegExp(pattern.label));
  const expression = new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
  const matches = [...node.data.matchAll(expression)];
  if (matches.length === 0) return;
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const match of matches) {
    const index = match.index ?? 0;
    fragment.append(node.data.slice(cursor, index));
    const pattern = patterns.find((candidate) => candidate.label.toLowerCase() === match[0].toLowerCase());
    fragment.append(pattern ? createAnnotation(match[0], pattern) : match[0]);
    cursor = index + match[0].length;
  }
  fragment.append(node.data.slice(cursor));
  node.replaceWith(fragment);
}

function createAnnotation(text: string, pattern: Pattern): HTMLElement {
  if (pattern.kind === "citation") return createCitation(text, pattern.context);
  const wrapper = document.createElement("span");
  wrapper.className = "jurvioLegalTerm";
  wrapper.tabIndex = 0;
  wrapper.setAttribute("role", "term");
  wrapper.setAttribute("aria-haspopup", "true");
  wrapper.append(text, createTermCard(pattern.context));
  return wrapper;
}

function createTermCard(context: LegalTermContext): HTMLElement {
  const card = document.createElement("span");
  card.className = "jurvioContextCard";
  card.setAttribute("role", "tooltip");
  const title = document.createElement("strong");
  title.textContent = context.term;
  const definition = document.createElement("span");
  definition.textContent = context.definition;
  const caution = document.createElement("span");
  caution.className = "jurvioContextCaution";
  caution.textContent = "General explanation, not legal advice. Meaning can depend on context.";
  const link = document.createElement("a");
  link.href = `/explainers/${context.slug}`;
  link.textContent = "Read the sourced explainer";
  card.append(title, definition, caution, link);
  return card;
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
  return value.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

