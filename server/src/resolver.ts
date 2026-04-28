import {
	CompletionItem,
	CompletionItemKind,
	ParameterInformation,
	Position,
	Range,
	SignatureInformation
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import {
	ClassInfo,
	DefinitionLocation,
	MemberInfo,
	NamespaceInfo,
	newLineRegExp
} from './parser';

export type TokenKind =
	| 'operator'
	| 'identifier'
	| 'typeName'
	| 'namespaceName'
	| 'functionName'
	| 'variableName'
	| 'memberName'
	| 'stringLiteral'
	| 'interpolation'
	| 'commandText'
	| 'comment'
	| 'punctuation'
	| 'unknown';

export interface TokenFlags {
	declaration?: boolean;
	interpolation?: boolean;
	commandText?: boolean;
	stringInterpolation?: boolean;
}

export interface Token {
	kind: TokenKind;
	range: Range;
	text: string;
	line: number;
	flags?: TokenFlags;
}

export type SymbolKind =
	| 'localVariable'
	| 'builtinVariable'
	| 'namespaceVariable'
	| 'namespaceFunction'
	| 'classType'
	| 'constructor'
	| 'instanceField'
	| 'instanceMethod'
	| 'namespace'
	| 'keyword'
	| 'unresolved'
	| 'inert';

export interface ResolvedSymbol {
	kind: SymbolKind;
	name: string;
	type: string;
	definition?: DefinitionLocation;
	documentation?: string;
	namespaceName?: string;
	classInfo?: ClassInfo;
	member?: MemberInfo;
}

export interface ResolvedReference {
	token: Token;
	symbol: ResolvedSymbol;
	isDeclaration: boolean;
	isReference: boolean;
	isCallable: boolean;
}

interface LocalBinding {
	name: string;
	type: string;
	lineDeclared: number;
	characterDeclared: number;
	lineUndeclared?: number;
	builtin: boolean;
}

interface ImplicitVariable {
	name: string;
	type: string;
}

interface NameAndType {
	name: string;
	type: string;
}

export interface CompletionContext {
	kind: 'namespace' | 'command' | 'namespaceMembers' | 'member' | 'expression' | 'none';
	namespaceName?: string;
	hostType?: string;
	activeNamespace?: string;
	visibleBindings?: readonly LocalBinding[];
}

export interface CallContext {
	symbol: ResolvedSymbol;
	paramNumber: number;
}

export interface ExpressionDiagnostic {
	message: string;
	range: Range;
}

export interface ExpressionAnalysis {
	type?: string;
	diagnostics: readonly ExpressionDiagnostic[];
}

export interface DocumentResolution {
	tokens: readonly Token[];
	references: readonly ResolvedReference[];
	visibleBindingsByLine: readonly (readonly LocalBinding[])[];
	getTokenAtPosition(position: Position): Token | undefined;
	getReferenceAtPosition(position: Position): ResolvedReference | undefined;
	getCompletionContext(position: Position): CompletionContext;
	getCallContext(position: Position): CallContext | undefined;
	analyzeExpression(expression: string, lineNumber: number, startCharacter: number): ExpressionAnalysis;
	getMemberAccessHostType(position: Position): string | undefined;
	getNamespaceQualifier(position: Position): string | undefined;
	hasNamespace(name: string): boolean;
}

interface ResolutionInputs {
	document: TextDocument;
	namespaces: ReadonlyMap<string, NamespaceInfo>;
	classes: ReadonlyMap<string, ClassInfo>;
	implicitVariables?: ImplicitVariable[];
}

interface SpecialSpan {
	line: number;
	start: number;
	end: number;
	kind: TokenKind;
	flags?: TokenFlags;
}

const FIRST_LINE_PARAM_REGEXP = /((?:[a-zA-Z][a-zA-Z0-9_]*::)?[A-Z][a-zA-Z0-9_]*(?:\[\])?)\s+([a-z][a-zA-Z0-9_]*)/g;
const RESERVED_VARIABLE_NAMES = new Set(['true', 'false', 'this', 'null', 'final', 'relative', 'private', 'pi']);

class DocumentResolutionImpl implements DocumentResolution {
	readonly tokens: readonly Token[];
	readonly references: readonly ResolvedReference[];
	readonly visibleBindingsByLine: readonly (readonly LocalBinding[])[];

	private readonly document: TextDocument;
	private readonly namespaces: ReadonlyMap<string, NamespaceInfo>;
	private readonly classes: ReadonlyMap<string, ClassInfo>;
	private readonly lines: readonly string[];
	private readonly activeNamespaceByLine: readonly (string | undefined)[];
	private readonly lineTokens: readonly (readonly Token[])[];
	private readonly lineReferences: readonly (readonly ResolvedReference[])[];

	constructor(inputs: ResolutionInputs) {
		this.document = inputs.document;
		this.namespaces = inputs.namespaces;
		this.classes = inputs.classes;
		this.lines = this.document.getText().split(newLineRegExp);

		const tokenMatrix = this.tokenizeDocument();
		this.lineTokens = tokenMatrix;
		this.tokens = tokenMatrix.flat();

		const bindingState = this.buildBindings(inputs.implicitVariables ?? []);
		this.visibleBindingsByLine = bindingState.visibleBindingsByLine;
		this.activeNamespaceByLine = bindingState.activeNamespaceByLine;

		const refs = this.buildReferences();
		this.lineReferences = refs.lineReferences;
		this.references = refs.references;
	}

	getTokenAtPosition(position: Position): Token | undefined {
		const lineTokens = this.lineTokens[position.line] ?? [];
		return smallestContaining(lineTokens, position, token => token.range);
	}

	getReferenceAtPosition(position: Position): ResolvedReference | undefined {
		const refs = this.lineReferences[position.line] ?? [];
		return smallestContaining(refs, position, ref => ref.token.range);
	}

	getCompletionContext(position: Position): CompletionContext {
		const line = this.lines[position.line]?.slice(0, position.character) ?? '';
		const activeNamespace = this.activeNamespaceByLine[position.line];
		const contextToken = this.getContextToken(position);

		if (contextToken?.kind !== 'stringLiteral' && contextToken?.kind !== 'commandText' &&
			/^\s*@using\s+[a-zA-Z0-9_]*$/.test(line)) {
			return { kind: 'namespace' };
		}

		const commandPrefixes = ['@bypass \\/', '@command \\/', '@console \\/'];
		if (contextToken?.kind === 'commandText' && new RegExp(`^\\s*(${commandPrefixes.join('|')})[a-z]*$`).test(line)) {
			return { kind: 'command' };
		}

		const codePrefix = this.getResolvablePrefix(position);
		if (codePrefix === undefined) {
			return { kind: 'none' };
		}

		const directMemberContext = this.getDirectReferenceMemberContext(position);
		if (directMemberContext !== undefined) {
			return directMemberContext;
		}

		const namespaceSuggestionRegExp = /(?:^|[\s([{+\-*/!=<>&|,])([a-zA-Z][a-zA-Z0-9_]*)::[a-zA-Z0-9_]*$/;
		const namespaceSuggestionRegExpRes = namespaceSuggestionRegExp.exec(codePrefix);
		if (namespaceSuggestionRegExpRes !== null) {
			return {
				kind: 'namespaceMembers',
				namespaceName: namespaceSuggestionRegExpRes[1]
			};
		}

		if (/\.([a-z][a-zA-Z0-9_]*)?$/.test(codePrefix)) {
			const callChain = parseCallChain(codePrefix);
			const lastNameAndType = getLastNameAndTypeFromCallChain(
				callChain,
				name => this.findVisibleBinding(name, position.line),
				activeNamespace,
				this.namespaces,
				this.classes
			);
			if (lastNameAndType !== undefined) {
				const hostType = this.normalizeTypeName(lastNameAndType.type, position.line);
				return {
					kind: 'member',
					hostType
				};
			}

			const hostExpression = getMemberAccessHostExpression(codePrefix);
			if (hostExpression !== undefined) {
				const analysis = this.analyzeExpression(hostExpression.text, position.line, hostExpression.startCharacter);
				if (analysis.diagnostics.length === 0 && analysis.type !== undefined && this.classes.has(analysis.type)) {
					return {
						kind: 'member',
						hostType: analysis.type
					};
				}
			}
			return { kind: 'none' };
		}

		const variableOrClassSuggestionRegExp = /(?:^|[\s([{+\-*/!=<>&|,])(?:[a-zA-Z][a-zA-Z0-9_]*)?$/;
		if (variableOrClassSuggestionRegExp.test(codePrefix)) {
			return {
				kind: 'expression',
				activeNamespace,
				visibleBindings: this.visibleBindingsByLine[position.line]
			};
		}

		return { kind: 'none' };
	}

	getCallContext(position: Position): CallContext | undefined {
		const line = this.getResolvablePrefix(position);
		if (line === undefined) {
			return undefined;
		}
		const activeNamespace = this.activeNamespaceByLine[position.line];
		const info = parseFunctionCall(
			line,
			activeNamespace,
			name => this.findVisibleBinding(name, position.line),
			this.namespaces,
			this.classes
		);
		if (info === undefined) {
			return undefined;
		}

		const symbol = this.resolveCanonicalSymbol(info.name, position.line);
		if (symbol === undefined) {
			return undefined;
		}

		return {
			symbol,
			paramNumber: info.paramNumber
		};
	}

	analyzeExpression(expression: string, lineNumber: number, startCharacter: number): ExpressionAnalysis {
		return new ExpressionTypeParser({
			expression,
			lineNumber,
			startCharacter,
			resolveChainType: segment => this.resolveStandaloneExpressionType(segment, lineNumber),
			normalizeType: type => this.normalizeTypeName(type, lineNumber),
			resolveMemberType: (hostType, memberName, isCall) => this.resolveMemberType(hostType, memberName, isCall, lineNumber),
			resolveIndexType: hostType => this.resolveIndexedType(hostType, lineNumber)
		}).analyze();
	}

	getMemberAccessHostType(position: Position): string | undefined {
		const lineText = this.lines[position.line] ?? '';
		const codePrefix = lineText.slice(0, position.character);
		if (!codePrefix.endsWith('.')) return undefined;

		const hostExpression = getMemberAccessHostExpression(codePrefix);
		if (hostExpression === undefined) return undefined;

		const analysis = this.analyzeExpression(hostExpression.text, position.line, hostExpression.startCharacter);
		if (analysis.diagnostics.length > 0 || analysis.type === undefined) return undefined;

		const normalized = this.normalizeTypeName(analysis.type, position.line);
		return this.classes.has(normalized) ? normalized : undefined;
	}

	hasNamespace(name: string): boolean {
		return this.namespaces.has(name);
	}

	getNamespaceQualifier(position: Position): string | undefined {
		const lineText = this.lines[position.line] ?? '';
		const codePrefix = lineText.slice(0, position.character);
		const match = /([a-zA-Z][a-zA-Z0-9_]*)::$/.exec(codePrefix);
		if (match === null) return undefined;
		return this.namespaces.has(match[1]) ? match[1] : undefined;
	}

	private getContextToken(position: Position): Token | undefined {
		const lineTokens = this.lineTokens[position.line] ?? [];
		const tokenAtPosition = smallestContaining(lineTokens, position, token => token.range);
		if (tokenAtPosition !== undefined) {
			return tokenAtPosition;
		}

		let bestEndingToken: Token | undefined;
		for (const token of lineTokens) {
			if (token.range.end.character === position.character &&
				(bestEndingToken === undefined || token.range.start.character >= bestEndingToken.range.start.character)) {
				bestEndingToken = token;
			}
		}
		return bestEndingToken;
	}

	private getContainingInterpolation(position: Position): Token | undefined {
		const lineTokens = this.lineTokens[position.line] ?? [];
		return lineTokens
			.filter(token => token.kind === 'interpolation')
			.sort(compareRanges)
			.find(token =>
				token.range.start.character <= position.character &&
				position.character < token.range.end.character);
	}

	private getResolvablePrefix(position: Position): string | undefined {
		const lineText = this.lines[position.line] ?? '';
		const contextToken = this.getContextToken(position);
		if (contextToken?.kind === 'comment' || contextToken?.kind === 'stringLiteral') {
			return undefined;
		}

		const interpolation = this.getContainingInterpolation(position);
		if (interpolation !== undefined) {
			const start = interpolation.range.start.character + 2;
			const end = Math.max(start, Math.min(position.character, interpolation.range.end.character - 2));
			return lineText.slice(start, end);
		}

		if (contextToken?.kind === 'commandText') {
			return undefined;
		}

		return lineText.slice(0, position.character);
	}

	private getDirectReferenceMemberContext(position: Position): CompletionContext | undefined {
		const refs = this.lineReferences[position.line] ?? [];
		const reference = refs.find(ref =>
			ref.token.range.end.character === position.character &&
			!ref.isDeclaration &&
			isDirectMemberSuggestionSymbol(ref.symbol));
		if (reference === undefined) {
			return undefined;
		}

		const hostType = this.resolveHostType(reference.symbol, position.line);
		if (!this.classes.has(hostType)) {
			return undefined;
		}

		return {
			kind: 'member',
			hostType
		};
	}

	getVisibleCompletionItems(line: number): CompletionItem[] {
		const visibleBindings = this.visibleBindingsByLine[line] ?? [];
		return visibleBindings.map(binding => ({
			label: binding.name,
			kind: CompletionItemKind.Variable,
			detail: `${binding.type} ${binding.name}`
		}));
	}

	private tokenizeDocument(): readonly (readonly Token[])[] {
		const result: Token[][] = [];
		for (let line = 0; line < this.lines.length; line++) {
			result.push(this.tokenizeLine(this.lines[line], line));
		}
		return result;
	}

	private tokenizeLine(lineText: string, line: number): Token[] {
		const tokens: Token[] = [];
		const trimmed = lineText.trim();

		if (trimmed === '') {
			return tokens;
		}

		if (trimmed.startsWith('#')) {
			tokens.push(makeToken('comment', line, 0, lineText.length, lineText));
			if (line === 0) {
				this.tokenizeFirstLineParameters(lineText, line, tokens);
			}
			return tokens;
		}

		const firstWord = trimmed.split(/\s+/)[0];
		const start = lineText.indexOf(firstWord);
		tokens.push(makeToken('operator', line, start, start + firstWord.length, firstWord));

		const remainderStart = start + firstWord.length;
		const remainder = lineText.slice(remainderStart);

		switch (firstWord) {
			case '@player':
			case '@command':
			case '@bypass':
			case '@console':
				tokenizeInterpolatedText(remainder, remainderStart, line, tokens, 'commandText');
				break;
			case '@prompt':
				this.tokenizePromptLine(remainder, remainderStart, line, tokens);
				break;
			default:
				tokenizeCode(remainder, remainderStart, line, tokens);
				break;
		}

		this.applySpecialSpans(lineText, line, tokens, firstWord, remainderStart);
		return tokens.sort(compareRanges);
	}

	private tokenizePromptLine(remainder: string, offset: number, line: number, tokens: Token[]) {
		const match = /^\s*(\S+)\s+(\S+)(.*)$/.exec(remainder);
		if (match === null) {
			tokenizeCode(remainder, offset, line, tokens);
			return;
		}

		const [, time, variable, rest] = match;
		const timeStart = remainder.indexOf(time);
		const variableStart = remainder.indexOf(variable, timeStart + time.length);
		tokenizeCode(remainder.slice(0, variableStart + variable.length), offset, line, tokens);
		if (rest.length > 0) {
			tokens.push(makeToken('commandText', line, offset + variableStart + variable.length, offset + remainder.length, remainder.slice(variableStart + variable.length), {
				commandText: true
			}));
		}
	}

	private tokenizeFirstLineParameters(lineText: string, line: number, tokens: Token[]) {
		const openingBracketPos = lineText.indexOf('(');
		const closingBracketPos = lineText.indexOf(')');
		const paramListStart = openingBracketPos === -1 ? lineText.indexOf('#') : openingBracketPos;
		const paramListEnd = closingBracketPos === -1 ? lineText.length : closingBracketPos;
		if (paramListStart === -1 || paramListEnd <= paramListStart) {
			return;
		}

		const paramsText = lineText.substring(paramListStart + 1, paramListEnd);
		const spans: SpecialSpan[] = [];
		for (const match of paramsText.matchAll(FIRST_LINE_PARAM_REGEXP)) {
			if (match.index === undefined) continue;
			const typeStart = paramListStart + 1 + match.index;
			const typeEnd = typeStart + match[1].length;
			const nameStart = typeEnd + paramsText.substring(match.index + match[1].length).search(/\S/);
			spans.push({
				line,
				start: typeStart,
				end: typeEnd,
				kind: 'typeName'
			});
			spans.push({
				line,
				start: nameStart,
				end: nameStart + match[2].length,
				kind: 'variableName',
				flags: { declaration: true }
			});
		}

		this.applySpans(tokens, spans, lineText);
	}

	private applySpecialSpans(lineText: string, line: number, tokens: Token[], firstWord: string, offset: number) {
		const spans: SpecialSpan[] = [];

		switch (firstWord) {
			case '@using': {
				const match = /^(\s*)(\S+)/.exec(lineText.slice(offset));
				if (match !== null) {
					const start = offset + match[1].length;
					spans.push({
						line,
						start,
						end: start + match[2].length,
						kind: 'namespaceName'
					});
				}
				break;
			}

			case '@define': {
				const match = /^@define\s+((?:[\w:]+(?:\[\])?))\s+(\w+)/.exec(lineText.trim());
				if (match !== null) {
					const typeStart = lineText.indexOf(match[1], offset);
					const nameStart = lineText.indexOf(match[2], typeStart + match[1].length);
					spans.push({ line, start: typeStart, end: typeStart + match[1].length, kind: 'typeName' });
					spans.push({
						line,
						start: nameStart,
						end: nameStart + match[2].length,
						kind: 'variableName',
						flags: { declaration: true }
					});
				}
				break;
			}

			case '@for': {
				const match = /^@for\s+((?:[\w:]+(?:\[\])?))\s+(\w+)\s+in\b/.exec(lineText.trim());
				if (match !== null) {
					const typeStart = lineText.indexOf(match[1], offset);
					const nameStart = lineText.indexOf(match[2], typeStart + match[1].length);
					spans.push({ line, start: typeStart, end: typeStart + match[1].length, kind: 'typeName' });
					spans.push({
						line,
						start: nameStart,
						end: nameStart + match[2].length,
						kind: 'variableName',
						flags: { declaration: true }
					});
				}
				break;
			}
		}

		this.applySpans(tokens, spans, lineText);
	}

	private applySpans(tokens: Token[], spans: readonly SpecialSpan[], lineText: string) {
		if (spans.length === 0) return;

		for (const span of spans) {
			tokens.push(makeToken(span.kind, span.line, span.start, span.end, lineText.slice(span.start, span.end), span.flags));
		}

		for (const span of spans) {
			for (let i = tokens.length - 1; i >= 0; i--) {
				const token = tokens[i];
				if (token.kind === span.kind && token.range.start.character === span.start && token.range.end.character === span.end) {
					continue;
				}
				if (token.range.start.line !== span.line) continue;
				if (token.range.start.character >= span.start && token.range.end.character <= span.end &&
					(token.kind === 'identifier' || token.kind === 'punctuation')) {
					tokens.splice(i, 1);
				}
			}
		}
	}

	private buildBindings(implicitVariables: readonly ImplicitVariable[]) {
		const globalBindings: LocalBinding[] = [
			{ name: 'player', type: 'Player', lineDeclared: -1, characterDeclared: 0, builtin: true },
			{ name: 'block', type: 'Block', lineDeclared: -1, characterDeclared: 0, builtin: true }
		];
		for (const variable of implicitVariables) {
			globalBindings.push({
				name: variable.name,
				type: variable.type,
				lineDeclared: -1,
				characterDeclared: 0,
				builtin: variable.name !== 'this'
			});
		}

		const blockStack: LocalBinding[][] = [];
		const lines = this.lines;
		let currentNamespace: string | undefined = undefined;
		const activeNamespaceByLine: (string | undefined)[] = new Array(lines.length).fill(undefined);

		if (lines.length > 0) {
			const firstLine = lines[0];
			const openingBracketPos = firstLine.indexOf('(');
			const closingBracketPos = firstLine.indexOf(')');
			const paramListStart = openingBracketPos === -1 ? firstLine.indexOf('#') : openingBracketPos;
			const paramListEnd = closingBracketPos === -1 ? firstLine.length : closingBracketPos;
			if (paramListStart !== -1 && paramListEnd > paramListStart) {
				const paramsText = firstLine.substring(paramListStart + 1, paramListEnd);
				for (const match of paramsText.matchAll(FIRST_LINE_PARAM_REGEXP)) {
					if (match.index === undefined) continue;
					const type = match[1];
					const name = match[2];
					const nameStart = paramListStart + 1 + match.index + match[1].length + paramsText.substring(match.index + match[1].length).search(/\S/);
					globalBindings.push({
						name,
						type,
						lineDeclared: 0,
						characterDeclared: nameStart,
						builtin: false
					});
				}
			}
		}

		for (let i = 0; i < lines.length; i++) {
			activeNamespaceByLine[i] = currentNamespace;
			const trimmed = lines[i].trim();
			if (trimmed === '' || trimmed.startsWith('#')) {
				continue;
			}

			const tokens = trimmed.split(/\s+/);
			if (tokens[0] === '@if') {
				blockStack.push([]);
			} else if (tokens[0] === '@for' && tokens.length >= 3) {
				blockStack.push([]);
				const name = tokens[2];
				const type = tokens[1];
				const charDeclared = lines[i].indexOf(name);
				const binding: LocalBinding = {
					name,
					type,
					lineDeclared: i,
					characterDeclared: charDeclared === -1 ? 0 : charDeclared,
					builtin: false
				};
				if (blockStack.length > 0) {
					blockStack[blockStack.length - 1].push(binding);
				}
			} else if (tokens[0] === '@fi' || tokens[0] === '@else' || tokens[0] === '@elseif' || tokens[0] === '@done') {
				const closedBindings = blockStack.pop();
				if (closedBindings !== undefined) {
					for (const binding of closedBindings) {
						binding.lineUndeclared = i;
						globalBindings.push(binding);
					}
				}
				if (tokens[0] === '@else' || tokens[0] === '@elseif') {
					blockStack.push([]);
				}
			}

			if (tokens[0] === '@define' && tokens.length >= 3) {
				let name = tokens[2];
				if (name.endsWith('=')) {
					name = name.substring(0, name.length - 1);
				}
				const binding: LocalBinding = {
					name,
					type: tokens[1],
					lineDeclared: i,
					characterDeclared: Math.max(0, lines[i].indexOf(name)),
					builtin: false
				};
				if (blockStack.length > 0) {
					blockStack[blockStack.length - 1].push(binding);
				} else {
					globalBindings.push(binding);
				}
			} else if (tokens.length === 2 && tokens[0] === '@using') {
				currentNamespace = tokens[1];
			}
		}

		const visibleBindingsByLine: LocalBinding[][] = [];
		for (let line = 0; line < lines.length; line++) {
			const visibleByName = new Map<string, LocalBinding>();
			for (const binding of globalBindings) {
				if (binding.lineDeclared < line && (binding.lineUndeclared === undefined || binding.lineUndeclared > line)) {
					visibleByName.set(binding.name, binding);
				}
			}
			visibleBindingsByLine.push([...visibleByName.values()]);
		}

		return {
			visibleBindingsByLine,
			activeNamespaceByLine
		};
	}

	private findVisibleBinding(name: string, lineNumber: number): LocalBinding | undefined {
		const visibleBindings = this.visibleBindingsByLine[lineNumber] ?? [];
		for (const binding of [...visibleBindings].reverse()) {
			if (binding.name === name) return binding;
		}
		return undefined;
	}

	private buildReferences() {
		const references: ResolvedReference[] = [];
		const lineReferences: ResolvedReference[][] = this.lines.map(() => []);

		for (const token of this.tokens) {
			if (!isReferenceBearingToken(token)) {
				continue;
			}

			const reference = this.resolveReferenceForToken(token);
			if (reference === undefined) {
				continue;
			}

			token.kind = classifyTokenKind(reference, token.kind);
			references.push(reference);
			lineReferences[token.line].push(reference);
		}

		return {
			references,
			lineReferences
		};
	}

	private resolveReferenceForToken(token: Token): ResolvedReference | undefined {
		if (token.kind === 'namespaceName' && !token.flags?.declaration) {
			return {
				token,
				symbol: {
					kind: 'namespace',
					name: token.text,
					type: 'Namespace',
					namespaceName: token.text
				},
				isDeclaration: false,
				isReference: true,
				isCallable: false
			};
		}

		if (token.kind === 'variableName' && token.flags?.declaration) {
			const binding = this.findDeclaredBinding(token);
			const symbol = binding === undefined ? unresolvedSymbol(token.text) : bindingToSymbol(binding, this.document.uri);
			return {
				token,
				symbol,
				isDeclaration: true,
				isReference: false,
				isCallable: false
			};
		}

		if (token.kind === 'typeName') {
			return {
				token,
				symbol: this.resolveTypeSymbol(token.text, token.line),
				isDeclaration: false,
				isReference: true,
				isCallable: false
			};
		}

		const symbol = this.resolveTokenSymbol(token);
		if (symbol === undefined) {
			return undefined;
		}

		return {
			token,
			symbol,
			isDeclaration: false,
			isReference: symbol.kind !== 'inert',
			isCallable: symbol.kind === 'namespaceFunction' || symbol.kind === 'instanceMethod' || symbol.kind === 'constructor'
		};
	}

	private findDeclaredBinding(token: Token): LocalBinding | undefined {
		const visibleBindings = this.visibleBindingsByLine[token.line + 1] ?? [];
		return visibleBindings.find(binding =>
			binding.name === token.text &&
			binding.lineDeclared === token.line &&
			binding.characterDeclared === token.range.start.character);
	}

	private resolveTypeSymbol(typeText: string, lineNumber: number): ResolvedSymbol {
		const normalizedType = this.normalizeTypeName(typeText, lineNumber);
		const currentClass = this.classes.get(normalizedType);
		if (currentClass === undefined) {
			return unresolvedSymbol(typeText);
		}
		return {
			kind: 'classType',
			name: normalizedType,
			type: normalizedType,
			definition: currentClass.definition,
			classInfo: currentClass
		};
	}

	private normalizeTypeName(typeText: string, lineNumber: number): string {
		if (this.classes.has(typeText)) {
			return typeText;
		}
		const activeNamespace = this.activeNamespaceByLine[lineNumber];
		if (activeNamespace !== undefined && this.classes.has(`${activeNamespace}::${typeText}`)) {
			return `${activeNamespace}::${typeText}`;
		}
		return typeText;
	}

	private resolveHostType(symbol: ResolvedSymbol, lineNumber: number): string {
		if ((symbol.kind === 'classType' || symbol.kind === 'constructor') && this.classes.has(symbol.type)) {
			return symbol.type;
		}

		if (symbol.classInfo !== undefined && this.classes.has(`${symbol.classInfo.namespaceName}::${symbol.type}`)) {
			return `${symbol.classInfo.namespaceName}::${symbol.type}`;
		}

		if (symbol.namespaceName !== undefined && this.classes.has(`${symbol.namespaceName}::${symbol.type}`)) {
			return `${symbol.namespaceName}::${symbol.type}`;
		}

		return this.normalizeTypeName(symbol.type, lineNumber);
	}

	private resolveStandaloneExpressionType(expression: string, lineNumber: number): string | undefined {
		const trimmed = expression.trim();
		if (trimmed === '') {
			return undefined;
		}

		const nameAndType = getResolvedNameAndTypeFromExpressionText(
			trimmed,
			this.activeNamespaceByLine[lineNumber],
			name => this.findVisibleBinding(name, lineNumber),
			this.namespaces,
			this.classes
		);
		if (nameAndType !== undefined) {
			return this.normalizeTypeName(nameAndType.type, lineNumber);
		}

		const directSymbol = this.resolveCanonicalSymbol(trimmed, lineNumber);
		if (directSymbol !== undefined) {
			return this.resolveHostType(directSymbol, lineNumber);
		}

		return 'Unknown';
	}

	private resolveMemberType(hostType: string, memberName: string, isCall: boolean, lineNumber: number): string | undefined {
		const normalizedHostType = this.normalizeTypeName(hostType, lineNumber);
		const currentClass = this.classes.get(normalizedHostType);
		if (currentClass === undefined) {
			return undefined;
		}

		const member = currentClass.members.get(isCall ? `${memberName}()` : memberName);
		return member?.returnType === undefined ? undefined : this.normalizeTypeName(member.returnType, lineNumber);
	}

	private resolveIndexedType(hostType: string, lineNumber: number): string | undefined {
		const normalizedHostType = this.normalizeTypeName(hostType, lineNumber);
		if (!normalizedHostType.endsWith('[]')) {
			return undefined;
		}
		return this.normalizeTypeName(normalizedHostType.slice(0, -2), lineNumber);
	}

	private resolveTokenSymbol(token: Token): ResolvedSymbol | undefined {
		const lineText = this.lines[token.line];
		const activeNamespace = this.activeNamespaceByLine[token.line];

		const directNamespace = this.tryResolveNamespaceQualifierToken(token, lineText);
		if (directNamespace !== undefined) {
			return directNamespace;
		}

		const nameAndType = getResolvedNameAndTypeAtToken(
			lineText,
			token,
			activeNamespace,
			name => this.findVisibleBinding(name, token.line),
			this.namespaces,
			this.classes
		);
		if (nameAndType === undefined) {
			const explicitScopedName = this.getExplicitScopedName(token, lineText);
			if (explicitScopedName !== undefined) {
				const explicitSymbol = this.resolveCanonicalSymbol(explicitScopedName, token.line);
				if (explicitSymbol !== undefined) {
					return explicitSymbol;
				}
			}

			const directSymbol = this.resolveCanonicalSymbol(token.text, token.line);
			if (directSymbol !== undefined) {
				return directSymbol;
			}

			if (token.kind === 'identifier' && RESERVED_VARIABLE_NAMES.has(token.text)) {
				return {
					kind: 'keyword',
					name: token.text,
					type: token.text
				};
			}
			return unresolvedSymbol(token.text);
		}

		return this.resolveCanonicalSymbol(nameAndType.name, token.line) ?? unresolvedSymbol(token.text);
	}

	private getExplicitScopedName(token: Token, lineText: string): string | undefined {
		const scopeOperatorStart = token.range.start.character - 2;
		if (scopeOperatorStart < 0 || lineText.slice(scopeOperatorStart, token.range.start.character) !== '::') {
			return undefined;
		}

		let namespaceEnd = scopeOperatorStart;
		let namespaceStart = namespaceEnd - 1;
		while (namespaceStart >= 0 && /[a-zA-Z0-9_]/.test(lineText[namespaceStart])) {
			namespaceStart--;
		}
		namespaceStart++;
		if (namespaceStart >= namespaceEnd) {
			return undefined;
		}

		return `${lineText.slice(namespaceStart, namespaceEnd)}::${token.text}`;
	}

	private tryResolveNamespaceQualifierToken(token: Token, lineText: string): ResolvedSymbol | undefined {
		const after = lineText.slice(token.range.end.character);
		if (!after.startsWith('::')) {
			return undefined;
		}

		return {
			kind: 'namespace',
			name: token.text,
			type: 'Namespace',
			namespaceName: token.text
		};
	}

	private resolveCanonicalSymbol(name: string, lineNumber: number): ResolvedSymbol | undefined {
		const dotPosition = name.indexOf('.');
		if (dotPosition !== -1) {
			const currentClass = this.classes.get(name.substring(0, dotPosition));
			const currentMember = currentClass?.members.get(name.substring(dotPosition + 1));
			if (currentClass === undefined || currentMember === undefined) {
				return undefined;
			}
			return memberToSymbol(name, currentClass, currentMember);
		}

		const scopeOperatorPosition = name.indexOf('::');
		if (scopeOperatorPosition !== -1) {
			const namespaceName = name.substring(0, scopeOperatorPosition);
			const memberName = name.substring(scopeOperatorPosition + 2);
			if (memberName.length !== 0 && /[A-Z]/.test(memberName[0])) {
				const qualifiedName = name.endsWith('()') ? name.substring(0, name.length - 2) : name;
				const currentClass = this.classes.get(qualifiedName);
				if (currentClass === undefined) return undefined;
				return {
					kind: name.endsWith('()') ? 'constructor' : 'classType',
					name,
					type: qualifiedName,
					definition: currentClass.definition,
					classInfo: currentClass
				};
			}

			const currentNamespace = this.namespaces.get(namespaceName);
			const currentMember = currentNamespace?.members.get(memberName);
			if (currentNamespace === undefined || currentMember === undefined) {
				return undefined;
			}
			return namespaceMemberToSymbol(name, namespaceName, currentMember);
		}

		if (/[A-Z]/.test(name[0])) {
			const className = name.endsWith('()') ? name.substring(0, name.length - 2) : name;
			const currentClass = this.classes.get(className);
			if (currentClass === undefined) return undefined;
			return {
				kind: name.endsWith('()') ? 'constructor' : 'classType',
				name,
				type: className,
				definition: currentClass.definition,
				classInfo: currentClass
			};
		}

		const binding = this.findVisibleBinding(name, lineNumber);
		if (binding !== undefined) {
			return bindingToSymbol(binding, this.document.uri);
		}

		return undefined;
	}
}

export function resolveDocument(inputs: ResolutionInputs): DocumentResolution {
	return new DocumentResolutionImpl(inputs);
}

function tokenizeInterpolatedText(text: string, offset: number, line: number, tokens: Token[], commandTextKind: 'commandText' | 'stringLiteral') {
	let index = 0;
	while (index < text.length) {
		const open = text.indexOf('{{', index);
		if (open === -1) {
			if (index < text.length) {
				tokens.push(makeToken(commandTextKind, line, offset + index, offset + text.length, text.slice(index), {
					commandText: commandTextKind === 'commandText'
				}));
			}
			return;
		}

		if (open > index) {
			tokens.push(makeToken(commandTextKind, line, offset + index, offset + open, text.slice(index, open), {
				commandText: commandTextKind === 'commandText'
			}));
		}

		const close = text.indexOf('}}', open + 2);
		if (close === -1) {
			tokens.push(makeToken(commandTextKind, line, offset + open, offset + text.length, text.slice(open), {
				commandText: commandTextKind === 'commandText'
			}));
			return;
		}

		tokens.push(makeToken('interpolation', line, offset + open, offset + close + 2, text.slice(open, close + 2), {
			interpolation: true,
			stringInterpolation: commandTextKind === 'stringLiteral'
		}));
		tokenizeCode(text.slice(open + 2, close), offset + open + 2, line, tokens, {
			interpolation: true,
			stringInterpolation: commandTextKind === 'stringLiteral'
		});
		index = close + 2;
	}
}

function tokenizeCode(text: string, offset: number, line: number, tokens: Token[], flags?: TokenFlags) {
	let index = 0;
	while (index < text.length) {
		const c = text[index];
		if (/\s/.test(c)) {
			index++;
			continue;
		}

		if (c === '"') {
			let end = index + 1;
			for (; end < text.length; end++) {
				if (text[end] === '"') {
					end++;
					break;
				}
			}
			const stringEnd = Math.min(end, text.length);
			tokens.push(makeToken('stringLiteral', line, offset + index, offset + stringEnd, text.slice(index, stringEnd), flags));
			if (stringEnd - index > 2) {
				tokenizeInterpolatedText(text.slice(index + 1, stringEnd - 1), offset + index + 1, line, tokens, 'stringLiteral');
			}
			index = stringEnd;
			continue;
		}

		if (/[a-zA-Z_]/.test(c)) {
			let end = index + 1;
			for (; end < text.length && /[a-zA-Z0-9_]/.test(text[end]); end++) {
				// keep scanning
			}
			tokens.push(makeToken('identifier', line, offset + index, offset + end, text.slice(index, end), flags));
			index = end;
			continue;
		}

		if (c === ':' && text[index + 1] === ':') {
			tokens.push(makeToken('punctuation', line, offset + index, offset + index + 2, '::', flags));
			index += 2;
			continue;
		}

		tokens.push(makeToken('punctuation', line, offset + index, offset + index + 1, c, flags));
		index++;
	}
}

function makeToken(kind: TokenKind, line: number, start: number, end: number, text: string, flags?: TokenFlags): Token {
	return {
		kind,
		line,
		text,
		range: {
			start: { line, character: start },
			end: { line, character: end }
		},
		flags
	};
}

function compareRanges(a: Token, b: Token): number {
	return a.range.start.character - b.range.start.character || a.range.end.character - b.range.end.character;
}

function smallestContaining<T>(items: readonly T[], position: Position, getRange: (item: T) => Range = item => item as unknown as Range): T | undefined {
	let best: T | undefined;
	let bestLength = Number.POSITIVE_INFINITY;
	for (const item of items) {
		const range = getRange(item);
		if (range.start.line !== position.line) continue;
		if (range.start.character <= position.character && position.character < range.end.character) {
			const length = range.end.character - range.start.character;
			if (length <= bestLength) {
				best = item;
				bestLength = length;
			}
		}
	}
	return best;
}

function isReferenceBearingToken(token: Token): boolean {
	return token.kind === 'identifier' || token.kind === 'typeName' || token.kind === 'namespaceName' || token.kind === 'variableName';
}

function classifyTokenKind(reference: ResolvedReference, fallback: TokenKind): TokenKind {
	switch (reference.symbol.kind) {
		case 'namespace':
			return 'namespaceName';
		case 'localVariable':
		case 'builtinVariable':
		case 'namespaceVariable':
			return 'variableName';
		case 'instanceField':
			return 'memberName';
		case 'namespaceFunction':
		case 'instanceMethod':
			return 'functionName';
		case 'classType':
		case 'constructor':
			return 'typeName';
		default:
			return fallback;
	}
}

function isDirectMemberSuggestionSymbol(symbol: ResolvedSymbol): boolean {
	return symbol.kind === 'localVariable' ||
		symbol.kind === 'builtinVariable' ||
		symbol.kind === 'namespaceVariable' ||
		symbol.kind === 'instanceField' ||
		symbol.kind === 'classType' ||
		symbol.kind === 'constructor';
}

function unresolvedSymbol(name: string): ResolvedSymbol {
	return {
		kind: 'unresolved',
		name,
		type: 'Unknown'
	};
}

function bindingToSymbol(binding: LocalBinding, uri: string): ResolvedSymbol {
	if (binding.name === 'this') {
		return {
			kind: 'localVariable',
			name: binding.name,
			type: binding.type
		};
	}

	return {
		kind: binding.builtin ? 'builtinVariable' : 'localVariable',
		name: binding.name,
		type: binding.type,
		definition: binding.lineDeclared >= 0 ? {
			uri,
			line: binding.lineDeclared,
			character: binding.characterDeclared
		} : undefined
	};
}

function memberToSymbol(name: string, currentClass: ClassInfo, currentMember: MemberInfo): ResolvedSymbol {
	return {
		kind: currentMember.kind === 'function' ? 'instanceMethod' : 'instanceField',
		name,
		type: currentMember.returnType || 'Void',
		definition: currentMember.definition,
		documentation: currentMember.documentation,
		classInfo: currentClass,
		member: currentMember
	};
}

function namespaceMemberToSymbol(name: string, namespaceName: string, currentMember: MemberInfo): ResolvedSymbol {
	return {
		kind: currentMember.kind === 'function' ? 'namespaceFunction' : 'namespaceVariable',
		name,
		type: currentMember.returnType || 'Void',
		definition: currentMember.definition,
		documentation: currentMember.documentation,
		namespaceName,
		member: currentMember
	};
}

interface MemberAccessHostExpression {
	text: string;
	startCharacter: number;
}

type ExpressionTokenKind =
	| 'identifier'
	| 'number'
	| 'string'
	| 'operator'
	| 'lparen'
	| 'rparen'
	| 'lbrack'
	| 'rbrack'
	| 'comma'
	| 'dot'
	| 'scope';

interface ExpressionToken {
	kind: ExpressionTokenKind;
	text: string;
	start: number;
	end: number;
}

interface ExpressionTypeParserOptions {
	expression: string;
	lineNumber: number;
	startCharacter: number;
	resolveChainType: (segment: string) => string | undefined;
	normalizeType: (type: string) => string;
	resolveMemberType: (hostType: string, memberName: string, isCall: boolean) => string | undefined;
	resolveIndexType: (hostType: string) => string | undefined;
}

type ExpressionParseResult = {
	type?: string;
	diagnostic?: ExpressionDiagnostic;
};

class ExpressionTypeParser {
	private readonly expression: string;
	private readonly lineNumber: number;
	private readonly startCharacter: number;
	private readonly resolveChainType: (segment: string) => string | undefined;
	private readonly normalizeType: (type: string) => string;
	private readonly resolveMemberType: (hostType: string, memberName: string, isCall: boolean) => string | undefined;
	private readonly resolveIndexType: (hostType: string) => string | undefined;
	private readonly tokens: readonly ExpressionToken[];
	private index = 0;

	constructor(options: ExpressionTypeParserOptions) {
		this.expression = options.expression;
		this.lineNumber = options.lineNumber;
		this.startCharacter = options.startCharacter;
		this.resolveChainType = options.resolveChainType;
		this.normalizeType = options.normalizeType;
		this.resolveMemberType = options.resolveMemberType;
		this.resolveIndexType = options.resolveIndexType;
		this.tokens = tokenizeExpression(options.expression);
	}

	analyze(): ExpressionAnalysis {
		try {
			if (this.tokens.length === 0) {
				return { diagnostics: [] };
			}

			const result = this.parseOr();
			if (result.diagnostic !== undefined) {
				return { diagnostics: [result.diagnostic] };
			}

			if (this.peek() !== undefined) {
				const token = this.peek()!;
				return {
					diagnostics: [this.makeDiagnostic(token, `Encountered unexpected operator: ${token.text}. No left-side arguments found.`)]
				};
			}

			return {
				type: result.type === undefined || result.type === 'Unknown' ? undefined : this.normalizeType(result.type),
				diagnostics: []
			};
		} catch (error) {
			if (error instanceof ExpressionParserDiagnostic) {
				return { diagnostics: [error.diagnostic] };
			}
			throw error;
		}
	}

	private parseOr(): ExpressionParseResult {
		return this.parseLeftAssociative(() => this.parseAnd(), ['||']);
	}

	private parseAnd(): ExpressionParseResult {
		return this.parseLeftAssociative(() => this.parseEquality(), ['&&']);
	}

	private parseEquality(): ExpressionParseResult {
		return this.parseLeftAssociative(() => this.parseRelational(), ['==', '!=']);
	}

	private parseRelational(): ExpressionParseResult {
		return this.parseLeftAssociative(() => this.parseAdditive(), ['<', '<=', '>', '>=']);
	}

	private parseAdditive(): ExpressionParseResult {
		return this.parseLeftAssociative(() => this.parseMultiplicative(), ['+', '-']);
	}

	private parseMultiplicative(): ExpressionParseResult {
		return this.parseLeftAssociative(() => this.parseExponent(), ['*', '/', '%']);
	}

	private parseExponent(): ExpressionParseResult {
		return this.parseLeftAssociative(() => this.parseUnary(), ['^']);
	}

	private parseLeftAssociative(parseOperand: () => ExpressionParseResult, operators: readonly string[]): ExpressionParseResult {
		let left = parseOperand();
		if (left.diagnostic !== undefined) {
			return left;
		}

		for (;;) {
			const token = this.peek();
			if (token === undefined || token.kind !== 'operator' || !operators.includes(token.text)) {
				return left;
			}

			this.index++;
			let right = parseOperand();
			if (right.diagnostic !== undefined) {
				return right;
			}
			if (right.type === undefined) {
				return {
					diagnostic: this.makeDiagnostic(token, `Encountered unexpected operator: ${token.text}. No right-side arguments found.`)
				};
			}

			left = this.applyBinaryOperator(left.type, token, right.type);
			if (left.diagnostic !== undefined) {
				return left;
			}
		}
	}

	private parseUnary(): ExpressionParseResult {
		const token = this.peek();
		if (token !== undefined && token.kind === 'operator' && ['!', '+', '-'].includes(token.text)) {
			this.index++;
			const operand = this.parseUnary();
			if (operand.diagnostic !== undefined) {
				return operand;
			}
			if (operand.type === undefined) {
				return {
					diagnostic: this.makeDiagnostic(token, `Encountered unexpected operator: ${token.text}. No right-side arguments found.`)
				};
			}
			return this.applyUnaryOperator(token, operand.type);
		}

		return this.parsePrimary();
	}

	private parsePrimary(): ExpressionParseResult {
		const token = this.peek();
		if (token === undefined) {
			return {};
		}

		if (token.kind === 'lparen') {
			this.index++;
			const inner = this.parseOr();
			if (inner.diagnostic !== undefined) {
				return inner;
			}
			const close = this.peek();
			if (close?.kind !== 'rparen') {
				return {
					diagnostic: this.makeDiagnostic(token, `Encountered unexpected operator: ${token.text}. No right-side arguments found.`)
				};
			}
			this.index++;
			return this.parsePostfix(inner.type);
		}

		if (token.kind === 'string') {
			this.index++;
			return this.parsePostfix('String');
		}

		if (token.kind === 'number') {
			this.index++;
			return this.parsePostfix(literalType(token.text));
		}

		if (token.kind !== 'identifier') {
			this.index++;
			return {
				diagnostic: this.makeDiagnostic(token, `Encountered unexpected operator: ${token.text}. No left-side arguments found.`)
			};
		}

		if (token.text === 'true' || token.text === 'false') {
			this.index++;
			return this.parsePostfix('Boolean');
		}
		if (token.text === 'null') {
			this.index++;
			return this.parsePostfix('Null');
		}
		if (token.text === 'pi') {
			this.index++;
			return this.parsePostfix('Double');
		}

		return this.parseChainExpression();
	}

	private parseChainExpression(): ExpressionParseResult {
		const start = this.peek()!.start;
		let end = this.peek()!.end;
		this.index++;

		if (this.match('scope')) {
			const scoped = this.peek();
			if (scoped?.kind === 'identifier') {
				end = scoped.end;
				this.index++;
			}
		}

		for (;;) {
			const token = this.peek();
			if (token === undefined) {
				break;
			}

			if (token.kind === 'lparen') {
				const endToken = this.parseArgumentList();
				if (endToken === undefined) {
					return {
						diagnostic: this.makeDiagnostic(token, `Encountered unexpected operator: ${token.text}. No right-side arguments found.`)
					};
				}
				end = endToken.end;
				continue;
			}

			if (token.kind === 'lbrack') {
				this.index++;
				const inner = this.parseOr();
				if (inner.diagnostic !== undefined) {
					return inner;
				}
				const close = this.peek();
				if (close?.kind !== 'rbrack') {
					return {
						diagnostic: this.makeDiagnostic(token, `Encountered unexpected operator: ${token.text}. No right-side arguments found.`)
					};
				}
				end = close.end;
				this.index++;
				continue;
			}

			if (token.kind === 'dot') {
				this.index++;
				const member = this.peek();
				if (member?.kind !== 'identifier') {
					return {
						diagnostic: this.makeDiagnostic(token, `Encountered unexpected operator: ${token.text}. No right-side arguments found.`)
					};
				}
				end = member.end;
				this.index++;
				continue;
			}

			break;
		}

		const type = this.resolveChainType(this.expression.slice(start, end));
		return this.parsePostfix(type);
	}

	private parsePostfix(baseType: string | undefined): ExpressionParseResult {
		let currentType = baseType;

		for (;;) {
			const token = this.peek();
			if (token === undefined) {
				return { type: currentType };
			}

			if (token.kind === 'lbrack') {
				this.index++;
				const inner = this.parseOr();
				if (inner.diagnostic !== undefined) {
					return inner;
				}
				const close = this.peek();
				if (close?.kind !== 'rbrack') {
					return {
						diagnostic: this.makeDiagnostic(token, `Encountered unexpected operator: ${token.text}. No right-side arguments found.`)
					};
				}
				this.index++;
				currentType = currentType === undefined ? undefined : this.resolveIndexType(currentType) ?? 'Unknown';
				continue;
			}

			if (token.kind === 'dot') {
				this.index++;
				const member = this.peek();
				if (member?.kind !== 'identifier') {
					return {
						diagnostic: this.makeDiagnostic(token, `Encountered unexpected operator: ${token.text}. No right-side arguments found.`)
					};
				}
				this.index++;

				let isCall = false;
				if (this.peek()?.kind === 'lparen') {
					const endToken = this.parseArgumentList();
					if (endToken === undefined) {
						return {
							diagnostic: this.makeDiagnostic(token, `Encountered unexpected operator: ${token.text}. No right-side arguments found.`)
						};
					}
					isCall = true;
				}

				currentType = currentType === undefined ? undefined : this.resolveMemberType(currentType, member.text, isCall) ?? 'Unknown';
				continue;
			}

			return { type: currentType };
		}
	}

	private parseArgumentList(): ExpressionToken | undefined {
		const open = this.peek();
		if (open?.kind !== 'lparen') {
			return undefined;
		}

		this.index++;
		if (this.peek()?.kind === 'rparen') {
			const close = this.peek()!;
			this.index++;
			return close;
		}

		for (;;) {
			const argument = this.parseOr();
			if (argument.diagnostic !== undefined) {
				throw new ExpressionParserDiagnostic(argument.diagnostic);
			}

			const token = this.peek();
			if (token?.kind === 'comma') {
				this.index++;
				continue;
			}
			if (token?.kind === 'rparen') {
				this.index++;
				return token;
			}
			return undefined;
		}
	}

	private applyUnaryOperator(token: ExpressionToken, operandType: string): ExpressionParseResult {
		if (token.text === '!') {
			if (operandType === 'Boolean') {
				return { type: 'Boolean' };
			}
			return {
				diagnostic: this.makeDiagnostic(token, `Operator '${token.text}' is not applicable on type: ${operandType}`)
			};
		}

		return this.applyBinaryOperator('Int', token, operandType);
	}

	private applyBinaryOperator(leftType: string | undefined, token: ExpressionToken, rightType: string): ExpressionParseResult {
		if (leftType === undefined) {
			return {
				diagnostic: this.makeDiagnostic(token, `Encountered unexpected operator: ${token.text}. No left-side arguments found.`)
			};
		}

		const resultType = inferOperatorResultType(leftType, token.text, rightType);
		if (resultType !== undefined) {
			return { type: resultType };
		}

		if (leftType === 'Unknown' || rightType === 'Unknown') {
			return {};
		}

		return {
			diagnostic: this.makeDiagnostic(token, `Operator '${token.text}' is not applicable on types: ${leftType}, ${rightType}`)
		};
	}

	private match(kind: ExpressionTokenKind): boolean {
		const token = this.peek();
		if (token?.kind !== kind) {
			return false;
		}
		this.index++;
		return true;
	}

	private peek(): ExpressionToken | undefined {
		return this.tokens[this.index];
	}

	private makeDiagnostic(token: ExpressionToken, message: string): ExpressionDiagnostic {
		return {
			message,
			range: {
				start: { line: this.lineNumber, character: this.startCharacter + token.start },
				end: { line: this.lineNumber, character: this.startCharacter + token.end }
			}
		};
	}
}

class ExpressionParserDiagnostic extends Error {
	readonly diagnostic: ExpressionDiagnostic;

	constructor(diagnostic: ExpressionDiagnostic) {
		super(diagnostic.message);
		this.diagnostic = diagnostic;
	}
}

function tokenizeExpression(expression: string): ExpressionToken[] {
	const tokens: ExpressionToken[] = [];
	let index = 0;

	while (index < expression.length) {
		const c = expression[index];
		if (/\s/.test(c)) {
			index++;
			continue;
		}

		if (c === '"') {
			let end = index + 1;
			for (; end < expression.length; end++) {
				if (expression[end] === '"') {
					end++;
					break;
				}
			}
			tokens.push({ kind: 'string', text: expression.slice(index, end), start: index, end });
			index = end;
			continue;
		}

		const twoCharOperator = expression.slice(index, index + 2);
		if (['::', '&&', '||', '<=', '>=', '==', '!='].includes(twoCharOperator)) {
			tokens.push({
				kind: twoCharOperator === '::' ? 'scope' : 'operator',
				text: twoCharOperator,
				start: index,
				end: index + 2
			});
			index += 2;
			continue;
		}

		if (/[0-9]/.test(c)) {
			let end = index + 1;
			while (end < expression.length && /[0-9.]/.test(expression[end])) {
				end++;
			}
			if (expression[end] === '-' && expression[end - 1] === 'E') {
				end++;
				while (end < expression.length && /[0-9.]/.test(expression[end])) {
					end++;
				}
			}
			if (/[dDlL]/.test(expression[end] ?? '')) {
				end++;
			}
			tokens.push({ kind: 'number', text: expression.slice(index, end), start: index, end });
			index = end;
			continue;
		}

		if (/[a-zA-Z_\u03c0]/.test(c)) {
			let end = index + 1;
			while (end < expression.length && /[a-zA-Z0-9_]/.test(expression[end])) {
				end++;
			}
			tokens.push({ kind: 'identifier', text: expression.slice(index, end), start: index, end });
			index = end;
			continue;
		}

		const kind: ExpressionTokenKind | undefined = {
			'(': 'lparen',
			')': 'rparen',
			'[': 'lbrack',
			']': 'rbrack',
			',': 'comma',
			'.': 'dot'
		}[c] as ExpressionTokenKind | undefined;
		if (kind !== undefined) {
			tokens.push({ kind, text: c, start: index, end: index + 1 });
			index++;
			continue;
		}

		if ('!+-*/%^<>'.includes(c)) {
			tokens.push({ kind: 'operator', text: c, start: index, end: index + 1 });
			index++;
			continue;
		}

		index++;
	}

	return tokens;
}

function literalType(literal: string): string {
	if (literal.toLowerCase().endsWith('l')) {
		return 'Long';
	}
	if (literal.toLowerCase().endsWith('d') || literal === 'pi' || literal === '\u03c0') {
		return 'Double';
	}
	if (literal.includes('.')) {
		return 'Float';
	}
	return 'Int';
}

interface OperatorOverload {
	readonly op: string;
	readonly rhs: string;
	readonly result: string;
}

// Mirrors the @Operation overloads on each builtin *Value class in the server
// (org.minr.server.scripts.builtin.types.**). Server dispatch is strict: it
// looks up the operator on the LEFT type only, with no implicit conversion
// or operator commutativity.
const OPERATOR_OVERLOADS: ReadonlyMap<string, readonly OperatorOverload[]> = (() => {
	const out = new Map<string, OperatorOverload[]>();
	const add = (lhs: string, op: string, rhs: string, result: string) => {
		const list = out.get(lhs);
		if (list === undefined) out.set(lhs, [{ op, rhs, result }]);
		else list.push({ op, rhs, result });
	};

	const NUMERICS = ['Int', 'Long', 'Float', 'Double'] as const;
	const NUMERIC_RANK: Record<string, number> = { Int: 0, Long: 1, Float: 2, Double: 3 };
	const widerNumeric = (a: string, b: string) => NUMERIC_RANK[a] >= NUMERIC_RANK[b] ? a : b;

	for (const lhs of NUMERICS) {
		add(lhs, '+', 'String', 'String');
		for (const rhs of NUMERICS) {
			const wider = widerNumeric(lhs, rhs);
			for (const op of ['+', '-', '*', '/', '%']) add(lhs, op, rhs, wider);
			add(lhs, '^', rhs, 'Double');
			for (const op of ['==', '!=', '<', '<=', '>', '>=']) add(lhs, op, rhs, 'Boolean');
		}
	}

	add('Boolean', '+', 'String', 'String');
	for (const op of ['&&', '||', '==', '!=']) add('Boolean', op, 'Boolean', 'Boolean');

	for (const rhs of ['String', 'Int', 'Long', 'Float', 'Double', 'Boolean', 'Player', 'Entity', 'Block', 'Item']) {
		add('String', '+', rhs, 'String');
	}
	add('String', '==', 'String', 'Boolean');
	add('String', '!=', 'String', 'Boolean');

	for (const lhs of ['Player', 'Entity', 'Block', 'Item']) {
		add(lhs, '+', 'String', 'String');
		add(lhs, '==', lhs, 'Boolean');
		add(lhs, '!=', lhs, 'Boolean');
	}

	// Vector2/Vector3 take a Double scalar; BlockVector2/BlockVector3 take an Int scalar.
	for (const [lhs, scalar] of [['Vector2', 'Double'], ['Vector3', 'Double'], ['BlockVector2', 'Int'], ['BlockVector3', 'Int']] as const) {
		for (const op of ['+', '-']) add(lhs, op, lhs, lhs);
		for (const op of ['*', '/']) {
			add(lhs, op, scalar, lhs);
			add(lhs, op, lhs, lhs);
		}
		for (const op of ['==', '!=', '<', '<=', '>', '>=']) add(lhs, op, lhs, 'Boolean');
	}

	add('Location', '-', 'Location', 'Vector3');
	add('BlockLocation', '-', 'BlockLocation', 'BlockVector3');
	for (const lhs of ['Location', 'BlockLocation', 'Position', 'Region']) {
		add(lhs, '==', lhs, 'Boolean');
		add(lhs, '!=', lhs, 'Boolean');
	}

	return out;
})();

function inferOperatorResultType(leftType: string, operator: string, rightType: string): string | undefined {
	const overloads = OPERATOR_OVERLOADS.get(leftType);
	if (overloads !== undefined) {
		const matching = overloads.filter(o => o.op === operator);
		if (matching.length === 0) return undefined;
		// `null` matches any single-arg parameter slot; multiple overloads make
		// it ambiguous and the server rejects.
		if (rightType === 'Null') return matching.length === 1 ? matching[0].result : undefined;
		return matching.find(o => o.rhs === rightType)?.result;
	}

	// Types not in the table: user-defined classes have == and != auto-generated
	// between same-type instances (see UserType in the server). Other operators
	// require explicit definitions that the resolver doesn't track yet.
	if ((operator === '==' || operator === '!=') && leftType === rightType && leftType !== 'Null' && leftType !== 'Unknown') {
		return 'Boolean';
	}

	return undefined;
}

function getMemberAccessHostExpression(codePrefix: string): MemberAccessHostExpression | undefined {
	const match = /(?:^|.)(?:\.([a-z][a-zA-Z0-9_]*)?)$/.exec(codePrefix);
	if (!match) {
		return undefined;
	}

	let dotIndex = codePrefix.length - 1;
	if (codePrefix[dotIndex] !== '.') {
		dotIndex -= match[1]?.length ?? 0;
		if (codePrefix[dotIndex] !== '.') {
			return undefined;
		}
	}

	let start = 0;
	for (let i = dotIndex - 1; i >= 0; i--) {
		const c = codePrefix[i];
		if (c === '"') {
			const newI = skipStringBackward(codePrefix, i);
			if (newI === undefined) {
				return undefined;
			}
			i = newI;
			continue;
		}
		if (c === ')') {
			const newI = skipParenthesizedExpression(codePrefix, i, ')');
			if (newI === undefined) {
				return undefined;
			}
			i = newI;
			continue;
		}
		if (c === ']') {
			const newI = skipParenthesizedExpression(codePrefix, i, ']');
			if (newI === undefined) {
				return undefined;
			}
			i = newI;
			continue;
		}
		if (/\s|[([{+\-*/%^!=<>&|,]/.test(c)) {
			start = i + 1;
			break;
		}
	}

	const raw = codePrefix.slice(start, dotIndex);
	const trimmed = raw.trimStart();
	return trimmed === '' ? undefined : {
		text: trimmed,
		startCharacter: start + (raw.length - trimmed.length)
	};
}

function skipStringBackward(line: string, pos: number): number | undefined {
	if (line[pos] !== '"') {
		return pos;
	}

	for (pos--; pos >= 0; pos--) {
		if (line[pos] === '"') {
			return pos;
		}
	}
	return undefined;
}

function skipParenthesizedExpression(line: string, pos: number, closingParentheses: string): number | undefined {
	const openingParentheses = closingParentheses === ')' ? '(' : '[';
	if (line[pos] !== closingParentheses) {
		return pos;
	}

	let openParenthesesCount = 0;
	for (; pos >= 0; pos--) {
		const c = line[pos];
		if (c === '"') {
			const newPos = skipStringBackward(line, pos);
			if (newPos === undefined) {
				return undefined;
			}
			pos = newPos;
		} else if (c === closingParentheses) {
			openParenthesesCount++;
		} else if (c === openingParentheses) {
			openParenthesesCount--;
			if (openParenthesesCount === 0) {
				return pos;
			}
		}
	}
	return undefined;
}

function parseCallChain(line: string): string[] {
	const result: string[] = [];

	let i = line.length - 1;
	for (; i >= 0; i--) {
		if (!/[a-zA-Z0-9_.]/.test(line[i])) {
			return [];
		}
		if (line[i] === '.') {
			break;
		}
	}
	if (i === -1) {
		return [];
	}

	let scopeOperatorUsed = false;
	while (i >= 0) {
		if (line[i] === '.') {
			if (i === 0) {
				return [];
			}
			let hasArraySubscript = false;
			let newI = skipParenthesizedExpression(line, i - 1, ']');
			if (newI === undefined) {
				return [];
			}
			if (newI < i - 1) {
				hasArraySubscript = true;
				i = newI;
			}
			let isFunction = false;
			newI = skipParenthesizedExpression(line, i - 1, ')');
			if (newI === undefined) {
				return [];
			}
			if (newI < i - 1) {
				isFunction = true;
				i = newI;
			}
			if (i <= 0) {
				return [];
			}
			let k = i - 1;
			for (; k >= 0; k--) {
				if (/[.:\s([{+\-*/%^!=<>&|,]/.test(line[k])) {
					break;
				}
				if (!/[a-zA-Z0-9_]/.test(line[k])) {
					return [];
				}
			}
			if (hasArraySubscript) {
				result.push('[]');
			}
			result.push(line.substring(k + 1, i) + (isFunction ? '()' : ''));
			if (k === -1) {
				return result.reverse();
			}
			i = k;
		} else if (line[i] === ':') {
			if (scopeOperatorUsed || i < 2 || line[i - 1] !== ':') {
				return [];
			}
			scopeOperatorUsed = true;
			let k = i - 2;
			for (; k >= 0; k--) {
				if (/[.:\s([{+\-*/%^!=<>&|,]/.test(line[k])) {
					break;
				}
				if (!/[a-zA-Z0-9_]/.test(line[k])) {
					return [];
				}
			}
			result.push(line.substring(k + 1, i + 1));
			if (k === -1) {
				return result.reverse();
			}
			i = k;
		} else if (/[.\s([{+\-*/%^!=<>&|,]/.test(line[i])) {
			return result.reverse();
		} else {
			return [];
		}
	}
	return [];
}

function getLastNameAndTypeFromCallChain(
	callChain: string[],
	findVisibleBinding: (name: string) => LocalBinding | undefined,
	activeNamespaceName: string | undefined,
	namespaces: ReadonlyMap<string, NamespaceInfo>,
	classes: ReadonlyMap<string, ClassInfo>
): NameAndType | undefined {
	if (callChain.length === 0) {
		return undefined;
	}

	let currentClass = '';
	let currentName = '';
	let startingI = 1;
	if (callChain[0].endsWith(':')) {
		startingI = 2;
		if (callChain.length === 1) {
			return undefined;
		}
		currentName = callChain[0].concat(callChain[1]);
		if (/[A-Z]/.test(callChain[1][0])) {
			if (!callChain[1].endsWith('()')) {
				return undefined;
			}
			currentClass = currentName.substring(0, currentName.length - 2);
		} else {
			const currentNamespaceInfo = namespaces.get(callChain[0].substring(0, callChain[0].length - 2));
			const currentNamespaceMember = currentNamespaceInfo?.members.get(callChain[1]);
			if (currentNamespaceMember === undefined) {
				return undefined;
			}
			currentClass = currentNamespaceMember.returnType;
		}
	} else {
		currentName = callChain[0];
		if (/[A-Z]/.test(callChain[0][0])) {
			if (!callChain[0].endsWith('()')) {
				return undefined;
			}
			currentClass = callChain[0].substring(0, callChain[0].length - 2);
		} else {
			const currentBinding = findVisibleBinding(callChain[0]);
			if (currentBinding !== undefined) {
				currentClass = currentBinding.type;
			} else {
				if (activeNamespaceName === undefined) {
					return undefined;
				}
				const activeNamespace = namespaces.get(activeNamespaceName);
				const currentMember = activeNamespace?.members.get(callChain[0]);
				if (currentMember === undefined) {
					return undefined;
				}
				currentName = activeNamespaceName + '::' + callChain[0];
				currentClass = currentMember.returnType;
			}
		}
	}

	for (let i = startingI; i < callChain.length; i++) {
		if (callChain[i] === '[]') {
			if (!currentClass.endsWith('[]')) {
				return undefined;
			}
			currentName = currentClass;
			currentClass = currentClass.substring(0, currentClass.length - 2);
			continue;
		}
		let currentClassInfo = classes.get(currentClass);
		if (currentClassInfo === undefined) {
			if (i !== 1 || activeNamespaceName === undefined) {
				return undefined;
			}
			currentClassInfo = classes.get(activeNamespaceName + '::' + currentClass);
			if (currentClassInfo === undefined) {
				return undefined;
			}
			currentClass = activeNamespaceName + '::' + currentClass;
		}
		const nextMember = currentClassInfo.members.get(callChain[i]);
		if (nextMember === undefined) {
			return undefined;
		}
		currentName = currentClass + '.' + nextMember.name;
		currentClass = nextMember.returnType;
	}

	return {
		name: currentName,
		type: currentClass
	};
}

function getResolvedNameAndTypeAtToken(
	line: string,
	token: Token,
	activeNamespace: string | undefined,
	findVisibleBinding: (name: string) => LocalBinding | undefined,
	namespaces: ReadonlyMap<string, NamespaceInfo>,
	classes: ReadonlyMap<string, ClassInfo>
): NameAndType | undefined {
	const i = token.range.end.character;
	let parseString = line.substring(0, i);
	if (i < line.length && line[i] === ':') {
		return undefined;
	} else if (i < line.length && line[i] === '(') {
		parseString += '().a';
	} else {
		parseString += '.a';
	}

	const callChain = parseCallChain(parseString);
	return getLastNameAndTypeFromCallChain(callChain, findVisibleBinding, activeNamespace, namespaces, classes);
}

function getResolvedNameAndTypeFromExpressionText(
	expression: string,
	activeNamespace: string | undefined,
	findVisibleBinding: (name: string) => LocalBinding | undefined,
	namespaces: ReadonlyMap<string, NamespaceInfo>,
	classes: ReadonlyMap<string, ClassInfo>
): NameAndType | undefined {
	if (expression.trim() === '') {
		return undefined;
	}

	const callChain = parseCallChain(expression.trim() + '.a');
	return getLastNameAndTypeFromCallChain(callChain, findVisibleBinding, activeNamespace, namespaces, classes);
}

function parseFunctionCall(
	line: string,
	activeNamespace: string | undefined,
	findVisibleBinding: (name: string) => LocalBinding | undefined,
	namespaces: ReadonlyMap<string, NamespaceInfo>,
	classes: ReadonlyMap<string, ClassInfo>
): { name: string; paramNumber: number } | undefined {
	let i = line.length - 1;
	let paramNumber = 0;
	for (; i >= 0; i--) {
		if (line[i] === '"') {
			const j = skipStringBackward(line, i);
			if (j === undefined) {
				return undefined;
			}
			i = j;
		} else if (line[i] === ')' || line[i] === ']') {
			const j = skipParenthesizedExpression(line, i, line[i]);
			if (j === undefined) {
				return undefined;
			}
			i = j;
		} else if (line[i] === '[') {
			return undefined;
		} else if (line[i] === ',') {
			paramNumber++;
		} else if (line[i] === '(') {
			if (i === 0) {
				return undefined;
			}
			if (/[\s([+\-*/%^!=<>&|,]/.test(line[i - 1])) {
				paramNumber = 0;
				continue;
			}
			if (!/[a-zA-Z0-9_]/.test(line[i - 1])) {
				return undefined;
			}
			const callChain = parseCallChain(line.substring(0, i) + '().');
			const lastNameAndType = getLastNameAndTypeFromCallChain(callChain, findVisibleBinding, activeNamespace, namespaces, classes);
			if (lastNameAndType === undefined) {
				return undefined;
			}
			return {
				name: lastNameAndType.name,
				paramNumber
			};
		}
	}
	return undefined;
}

export function symbolToHoverText(symbol: ResolvedSymbol, defaultNamespacesSourceUri: string): { signature: string; documentation?: string } {
	let isBuiltIn = false;
	if ((symbol.kind === 'namespaceFunction' || symbol.kind === 'instanceMethod') && symbol.definition?.uri === defaultNamespacesSourceUri) {
		isBuiltIn = true;
	}
	return {
		signature: `${symbol.type !== 'Void' ? symbol.type + ' ' : ''}${symbol.name}${isBuiltIn ? ' (builtin)' : ''}`,
		documentation: symbol.documentation
	};
}

export function symbolToSignatureInformation(symbol: ResolvedSymbol): SignatureInformation[] {
	if (symbol.member?.signature !== undefined) {
		return [symbol.member.signature];
	}
	if (symbol.classInfo !== undefined && symbol.kind === 'constructor') {
		const constructorName = symbol.name.includes('::') ? symbol.name.substring(symbol.name.indexOf('::') + 2) : symbol.name;
		return symbol.classInfo.memberSignatures.get(constructorName) ?? [];
	}
	return [];
}

export function makeCompletionItemForBinding(binding: { name: string; type: string }): CompletionItem {
	return {
		label: binding.name,
		kind: CompletionItemKind.Variable,
		detail: `${binding.type} ${binding.name}`
	};
}

export function cloneSignature(signature: SignatureInformation, activeParameter: number): SignatureInformation {
	const parameters: ParameterInformation[] | undefined = signature.parameters?.map(parameter => ({ ...parameter }));
	return {
		label: signature.label,
		documentation: signature.documentation,
		parameters,
		activeParameter
	};
}
