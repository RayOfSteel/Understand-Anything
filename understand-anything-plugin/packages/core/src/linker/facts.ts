/**
 * A single fact instance produced by a tree-sitter query or a builtin
 * provider. `file` is the project-relative path of the originating file;
 * all other fields are string values (capture names or provider fields).
 * Fields starting with "_" are provider-internal and are dropped by
 * finalize passes.
 */
export interface Fact {
  file: string;
  [field: string]: string;
}
