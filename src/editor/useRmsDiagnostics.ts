// Superseded by src/useParsedDocument.ts (docs/breakdown-design.md §6.2:
// "one parse, in the worker" — Breakdown needs the full ParseResult/AST,
// not just diagnostics, so the parse was lifted from CodePane to
// AppContent). This file is intentionally left empty (this sandbox
// couldn't delete it — see CLAUDE.md's recurring environment-caveat notes
// for prior phases hitting the same limitation); nothing imports it.
export {};
