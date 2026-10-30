// js-yaml 4 ships no types; the workflow trigger test only needs load().
declare module "js-yaml" {
  export function load(source: string, options?: { filename?: string }): unknown;
}
