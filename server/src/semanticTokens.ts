import { SemanticTokensBuilder, SemanticTokensLegend } from 'vscode-languageserver/node';
import { DocumentResolution, ResolvedReference, ResolvedSymbol, Token } from './resolver';

const tokenTypes = [
	'namespace',     // 0
	'class',         // 1
	'function',      // 2
	'method',        // 3
	'property',      // 4
	'variable',      // 5
	'parameter',     // 6
	'string',        // 7
	'number',        // 8
	'comment',       // 9
	'keyword',       // 10
	'operator',      // 11
] as const;

const tokenModifiers = [
	'declaration',    // bit 0
	'readonly',       // bit 1
	'static',         // bit 2
	'defaultLibrary', // bit 3
] as const;

type TokenTypeName = typeof tokenTypes[number];
type ModifierName = typeof tokenModifiers[number];

const TYPE_INDEX: Record<TokenTypeName, number> = Object.fromEntries(
	tokenTypes.map((t, i) => [t, i])
) as Record<TokenTypeName, number>;

const MODIFIER_BIT: Record<ModifierName, number> = Object.fromEntries(
	tokenModifiers.map((m, i) => [m, 1 << i])
) as Record<ModifierName, number>;

export const semanticTokensLegend: SemanticTokensLegend = {
	tokenTypes: [...tokenTypes],
	tokenModifiers: [...tokenModifiers],
};

export interface SemanticTokensContext {
	documentUri: string;
	isBuiltInDefinition(uri: string | undefined): boolean;
	isBuiltInNamespace(name: string): boolean;
}

interface Classification {
	type: TokenTypeName;
	modifiers: number;
}

const PUNCTUATION_AS_OPERATOR = new Set([
	'+', '-', '*', '/', '%',
	'=', '!', '&', '|', '^',
	'<', '>', '?',
]);

export function buildSemanticTokens(resolution: DocumentResolution, ctx: SemanticTokensContext): number[] {
	const referenceByToken = new Map<Token, ResolvedReference>();
	for (const ref of resolution.references) {
		referenceByToken.set(ref.token, ref);
	}

	const builder = new SemanticTokensBuilder();
	for (const token of resolution.tokens) {
		const classification = classify(token, referenceByToken.get(token), ctx);
		if (classification === undefined) {
			continue;
		}
		const length = token.range.end.character - token.range.start.character;
		builder.push(
			token.range.start.line,
			token.range.start.character,
			length,
			TYPE_INDEX[classification.type],
			classification.modifiers,
		);
	}
	return builder.build().data;
}

function classify(token: Token, reference: ResolvedReference | undefined, ctx: SemanticTokensContext): Classification | undefined {
	const declarationMod = token.flags?.declaration ? MODIFIER_BIT.declaration : 0;

	switch (token.kind) {
		case 'operator':
			// Line-leading @-keyword (e.g. @if, @for, @bypass). Not an infix operator.
			return { type: 'keyword', modifiers: 0 };
		case 'comment':
			return { type: 'comment', modifiers: 0 };
		case 'stringLiteral':
			return { type: 'string', modifiers: 0 };
		case 'numberLiteral':
			return { type: 'number', modifiers: 0 };
		case 'interpolation':
			return { type: 'operator', modifiers: 0 };
		case 'commandText':
			return undefined;
		case 'memberName':
			return { type: 'property', modifiers: declarationMod };
		case 'namespaceName': {
			const mods = declarationMod | (ctx.isBuiltInNamespace(token.text) ? MODIFIER_BIT.defaultLibrary : 0);
			return { type: 'namespace', modifiers: mods };
		}
		case 'typeName': {
			const builtIn = reference !== undefined && ctx.isBuiltInDefinition(reference.symbol.definition?.uri);
			return { type: 'class', modifiers: declarationMod | (builtIn ? MODIFIER_BIT.defaultLibrary : 0) };
		}
		case 'variableName':
			return classifyVariable(reference, declarationMod, ctx);
		case 'functionName':
			return classifyFunction(reference, declarationMod, ctx);
		case 'punctuation':
			return PUNCTUATION_AS_OPERATOR.has(token.text)
				? { type: 'operator', modifiers: 0 }
				: undefined;
		case 'identifier':
		case 'unknown':
			return undefined;
	}
}

function classifyVariable(reference: ResolvedReference | undefined, declarationMod: number, ctx: SemanticTokensContext): Classification | undefined {
	if (reference === undefined) {
		return { type: 'variable', modifiers: declarationMod };
	}
	const symbol = reference.symbol;
	switch (symbol.kind) {
		case 'localVariable':
			if (isParameter(symbol, ctx)) {
				return { type: 'parameter', modifiers: 0 };
			}
			return { type: 'variable', modifiers: declarationMod };
		case 'builtinVariable':
			return { type: 'variable', modifiers: MODIFIER_BIT.readonly | MODIFIER_BIT.defaultLibrary };
		case 'namespaceVariable': {
			const builtIn = ctx.isBuiltInDefinition(symbol.definition?.uri);
			return { type: 'variable', modifiers: MODIFIER_BIT.static | (builtIn ? MODIFIER_BIT.defaultLibrary : 0) };
		}
		default:
			return { type: 'variable', modifiers: declarationMod };
	}
}

function classifyFunction(reference: ResolvedReference | undefined, declarationMod: number, ctx: SemanticTokensContext): Classification | undefined {
	if (reference === undefined) {
		return { type: 'function', modifiers: declarationMod };
	}
	const symbol = reference.symbol;
	const builtIn = ctx.isBuiltInDefinition(symbol.definition?.uri) ? MODIFIER_BIT.defaultLibrary : 0;
	switch (symbol.kind) {
		case 'namespaceFunction':
			return { type: 'function', modifiers: declarationMod | MODIFIER_BIT.static | builtIn };
		case 'instanceMethod':
			return { type: 'method', modifiers: declarationMod | builtIn };
		default:
			return { type: 'function', modifiers: declarationMod };
	}
}

// Locals whose definition lives in a sibling .nms file came from the function's
// signature — i.e. parameters. (Built-in identifiers go through `builtinVariable`
// and aren't seen here; the document's own URI is .msc, so anything resolving to
// a different .nms URI must be a signature-supplied parameter.)
function isParameter(symbol: ResolvedSymbol, ctx: SemanticTokensContext): boolean {
	const defUri = symbol.definition?.uri;
	if (defUri === undefined) return false;
	if (defUri === ctx.documentUri) return false;
	if (ctx.isBuiltInDefinition(defUri)) return false;
	return defUri.endsWith('.nms');
}
