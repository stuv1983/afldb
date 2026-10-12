/**
 * The SQL a module actually SENDS, for the ISSUE-099 obligation O1 checks in
 * settle-afltables.test.ts. DB-free, so tests/executable-statements.test.ts
 * exercises it without a database.
 *
 * postgres.js issues SQL only through tagged templates, so the executable
 * statements are exactly the `tx`/`sql` tagged-template bodies. AFLDB-ISSUE-315:
 * the extraction once ran a regex over the raw file, so a comment that put a
 * backtick after the word `tx` was read as a template (`settle-afltables.ts`'s
 * "never `tx` — a recovered `40P01` raised on `tx` would still be" note gave
 * two prose "statements"). The source is now parsed by the TypeScript compiler
 * and only real TaggedTemplateExpression nodes are read, so comments, string
 * literals, untagged templates and regular expressions can never be mistaken
 * for a statement, and none can hide one.
 */
import ts from 'typescript';

/** True for a `tx`/`sql` tag, bare or with type arguments (`sql<Row[]>`). */
function isStatementTag(tag: ts.Expression): boolean {
  return ts.isIdentifier(tag) && (tag.text === 'tx' || tag.text === 'sql');
}

/**
 * The template's literal text as written, each `${…}` replaced by a space.
 * Read from the source span rather than the cooked value, so escapes are
 * kept exactly as the earlier raw extraction kept them.
 */
function templateBody(template: ts.TemplateLiteral, file: ts.SourceFile): string {
  if (ts.isNoSubstitutionTemplateLiteral(template)) return template.getText(file).slice(1, -1);
  // TemplateHead is "`…${", each middle "}…${" and the tail "}…`".
  const parts = [template.head.getText(file).slice(1, -2)];
  for (const span of template.templateSpans) {
    const text = span.literal.getText(file);
    parts.push(text.slice(1, ts.isTemplateTail(span.literal) ? -1 : -2));
  }
  return parts.join(' ');
}

/** The `tx`/`sql` tagged-template bodies in `source`, in source order, whitespace collapsed. */
export function executableStatements(source: string, fileName = 'source.ts'): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const statements: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTaggedTemplateExpression(node) && isStatementTag(node.tag)) {
      const body = templateBody(node.template, file).replace(/\s+/g, ' ').trim();
      if (body) statements.push(body);
    }
    // Substitutions are visited too, so a statement nested in another's `${…}` is not hidden.
    ts.forEachChild(node, visit);
  };
  visit(file);
  return statements;
}
