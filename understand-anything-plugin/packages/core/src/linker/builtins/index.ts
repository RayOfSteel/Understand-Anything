import type { BuiltinProvider } from "./types.js";
import {
  csharpClassFqnProvider,
  csharpMethodDeclProvider,
  csharpRegistrationProvider,
} from "./csharp.js";
import { xamlTypeUsageProvider } from "./xaml.js";
import {
  razorUsingDirectiveProvider,
  razorComponentDeclProvider,
  razorComponentTagProvider,
  razorInjectProvider,
} from "./razor.js";

export type { BuiltinProvider, WarnFn } from "./types.js";

export const builtinProviders: BuiltinProvider[] = [
  csharpClassFqnProvider,
  csharpMethodDeclProvider,
  csharpRegistrationProvider,
  xamlTypeUsageProvider,
  razorUsingDirectiveProvider,
  razorComponentDeclProvider,
  razorComponentTagProvider,
  razorInjectProvider,
];

export function builtinProviderMap(): Map<string, BuiltinProvider> {
  return new Map(builtinProviders.map((p) => [p.name, p]));
}
