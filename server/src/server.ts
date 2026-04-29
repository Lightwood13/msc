/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
	createConnection,
	TextDocuments,
	Diagnostic,
	DiagnosticSeverity,
	CodeAction,
	CodeActionKind,
	CodeActionParams,
	ProposedFeatures,
	InitializeParams,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	InitializeResult,
	MarkupKind
} from 'vscode-languageserver/node';

import {
	TextDocument
} from 'vscode-languageserver-textdocument';
import {
	SignatureHelp,
	SignatureHelpParams,
	Definition,
	DefinitionParams,
	Hover,
	HoverParams,
	Location
} from 'vscode-languageserver-protocol';
import {
	access,
	readFile as readFileAsync
} from 'fs/promises';
import {
	files
} from 'node-dir';
import {
	basename,
	dirname,
	extname,
	join,
	normalize,
	resolve
} from 'path';
import {
	fileURLToPath,
	pathToFileURL
} from 'url';

import {
	NamespaceInfo,
	ClassInfo,
	DefinitionLocation,
	parseNamespaceFile,
	newLineRegExp,
	namespaceSignatureRegExp,
	classSignatureRegExp,
	functionSignatureRegExp,
	constructorSignatureRegExp,
	variableSignatureRegExp
} from './parser';
import {
	keywords,
	keywordsWithoutAtSymbol,
	minecraftCommands
} from './keywords';
import { DiagnosticData, Fix, lineOpsToEdits, parseSuppressions, raise, RuleCategory } from './lint';
import { RULES } from './rules';
import {
	DocumentResolution,
	makeCompletionItemForBinding,
	resolveDocument,
	ResolvedSymbol,
	symbolToHoverText
} from './resolver';

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasWorkspaceFolderCapability = false;

connection.onInitialize((params: InitializeParams) => {
	const capabilities = params.capabilities;

	hasWorkspaceFolderCapability = !!(
		capabilities.workspace && !!capabilities.workspace.workspaceFolders
	);

	const result: InitializeResult = {
			capabilities: {
				textDocumentSync: TextDocumentSyncKind.Incremental,
				// Tell the client that this server supports code completion.
				completionProvider: {
					triggerCharacters: ['.', ':']
				},
				signatureHelpProvider: {
					triggerCharacters: ['(', ',']
				},
				definitionProvider: true,
				hoverProvider: true,
				codeActionProvider: true
			}
		};
	if (hasWorkspaceFolderCapability) {
		result.capabilities.workspace = {
			workspaceFolders: {
				supported: true
			}
		};
	}
	return result;
});

connection.onInitialized(() => {
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders(_event => {
			connection.console.log('Workspace folder change event received.');
		});
	}
	connection.sendNotification('getDefaultNamespaces');
	void refreshNamespaceFiles();
	void refreshCategoryOverrides();
});

connection.onDidChangeConfiguration(async () => {
	await refreshCategoryOverrides();
	for (const document of documents.all()) {
		void validateAndReportDiagnostics(document);
	}
});

const documentResolutions: Map<string, Promise<DocumentResolution>> = new Map();
const defaultNamespaces: Map<string, NamespaceInfo> = new Map();
const defaultClasses: Map<string, ClassInfo> = new Map();
const namespaces: Map<string, NamespaceInfo> = new Map();
const classes: Map<string, ClassInfo> = new Map();
interface ScriptParameter {
	name: string;
	type: string;
	uri: string;
	line: number;
	character: number;
}

interface ScriptContext {
	thisType?: string;
	// Namespace the script body is implicitly inside (the enclosing `.nms`).
	// Mirrors the server's parse context: a function/method/constructor body
	// runs with its own namespace active without a leading `@using`.
	implicitNamespace?: string;
	parameters: readonly ScriptParameter[];
}

const EMPTY_SCRIPT_CONTEXT: ScriptContext = { parameters: [] };
const scriptContextCache: Map<string, ScriptContext> = new Map();
let defaultNamespacesSourceUri: string = '';

// Diagnostic publishing is gated on these: until both sources of namespace
// state have been loaded at least once, validateAndReportDiagnostics emits
// empty diagnostics. Each loader flips its flag and revalidates open docs.
let defaultsLoaded = false;
let workspaceLoaded = false;

// User-configured per-category severity overrides (`msc.diagnostics.categories.*`).
// `'default'` (or absent) keeps each rule's built-in severity; `'off'` drops the
// diagnostic entirely. Refreshed on init and on workspace/didChangeConfiguration.
type CategoryOverride = 'error' | 'warning' | 'info' | 'off';
const CATEGORIES: readonly RuleCategory[] = ['lexical', 'syntax', 'semantic', 'security', 'style'];
const SEVERITY_FROM_OVERRIDE: Record<Exclude<CategoryOverride, 'off'>, DiagnosticSeverity> = {
	error: DiagnosticSeverity.Error,
	warning: DiagnosticSeverity.Warning,
	info: DiagnosticSeverity.Information
};
const categoryOverrides: Map<RuleCategory, CategoryOverride> = new Map();

async function refreshCategoryOverrides(): Promise<void> {
	try {
		const settings = await connection.workspace.getConfiguration('msc.diagnostics.categories');
		categoryOverrides.clear();
		if (settings && typeof settings === 'object') {
			for (const category of CATEGORIES) {
				const value = (settings as Record<string, unknown>)[category];
				if (value === 'error' || value === 'warning' || value === 'info' || value === 'off') {
					categoryOverrides.set(category, value);
				}
			}
		}
	} catch {
		// Client may not support workspace/configuration; fall back to rule defaults.
		categoryOverrides.clear();
	}
}

async function refreshNamespaceFiles() {
	try {
		let fileList: string[];
		try {
			fileList = await new Promise<string[]>((res, rej) => {
				files('.', (err, found) => err ? rej(err) : res(found));
			});
		} catch (err) {
			console.log('Unable to scan directory: ' + err);
			return;
		}

		documentResolutions.clear();
		namespaces.clear();
		classes.clear();
		scriptContextCache.clear();
		defaultNamespaces.forEach((value, key) => namespaces.set(key, value));
		defaultClasses.forEach((value, key) => classes.set(key, value));

		await Promise.all(fileList
			.filter(filename => filename.split('.').pop() === 'nms')
			.map(async filename => {
				try {
					const data = await readFileAsync(filename);
					parseNamespaceFile(data.toString(), namespaces, classes, pathToFileURL(resolve(filename)).toString());
				} catch (err) {
					console.log('Unable to read file: ' + err);
				}
			}));
	} finally {
		// Always flip the gate, even on scan failure — otherwise diagnostics
		// stay permanently disabled for the session.
		workspaceLoaded = true;
		// Open documents resolved before this point may have been validated
		// against a partial namespace map; re-run them now that loading is done.
		revalidateAllOpenDocuments();
	}
}

function revalidateAllOpenDocuments() {
	for (const document of documents.all()) {
		void validateAndReportDiagnostics(document);
	}
}

function getDocumentResolution(documentUri: string): Promise<DocumentResolution> {
	let result = documentResolutions.get(documentUri);
	if (!result)
		result = refreshDocumentResolution(documentUri);
	return result;
}

function refreshDocumentResolution(documentUri: string): Promise<DocumentResolution> {
	const result = (async () => {
		const document = documents.get(documentUri);
		if (document === undefined) {
			console.log('Couldn\'t read file ' + documentUri);
			throw new Error(`Could not read document ${documentUri}`);
		}

		const context = await resolveScriptContext(documentUri);
		const implicitVariables = [];
		if (context.thisType !== undefined) {
			implicitVariables.push({ name: 'this', type: context.thisType });
		}
		for (const param of context.parameters) {
			implicitVariables.push({
				name: param.name,
				type: param.type,
				definition: { uri: param.uri, line: param.line, character: param.character }
			});
		}
		return resolveDocument({
			document,
			namespaces,
			classes,
			implicitVariables,
			implicitNamespace: context.implicitNamespace
		});
	})();
	documentResolutions.set(documentUri, result);
	return result;
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch (_err) {
		return false;
	}
}

// Parse a `(Type name, ...)` parameter list out of an .nms signature line and
// return per-parameter positions so the resolver can wire them up as bindings
// with proper go-to-definition targets.
const SIGNATURE_PARAM_REGEXP = /^\s*((?:[a-zA-Z][a-zA-Z0-9_]*::)?[A-Z][a-zA-Z0-9_]*(?:\[\])?)\s+([a-z][a-zA-Z0-9_]*)\s*$/;

function parseSignatureParameters(line: string, uri: string, lineNumber: number): ScriptParameter[] {
	const open = line.indexOf('(');
	const close = line.lastIndexOf(')');
	if (open === -1 || close <= open) return [];

	const inside = line.substring(open + 1, close);
	const baseOffset = open + 1;
	const segments: { text: string; start: number }[] = [];
	let depth = 0;
	let segmentStart = 0;
	for (let i = 0; i < inside.length; i++) {
		const c = inside[i];
		if (c === '(' || c === '[') depth++;
		else if (c === ')' || c === ']') depth--;
		else if (c === ',' && depth === 0) {
			segments.push({ text: inside.slice(segmentStart, i), start: segmentStart });
			segmentStart = i + 1;
		}
	}
	segments.push({ text: inside.slice(segmentStart), start: segmentStart });

	const params: ScriptParameter[] = [];
	for (const { text, start } of segments) {
		const match = SIGNATURE_PARAM_REGEXP.exec(text);
		if (match === null) continue;
		const [, type, name] = match;
		const nameOffsetInSegment = text.lastIndexOf(name);
		params.push({
			name,
			type,
			uri,
			line: lineNumber,
			character: baseOffset + start + nameOffsetInSegment
		});
	}
	return params;
}

function collectScriptContext(namespaceDefinitionPath: string, text: string, targetPath: string, expectedKind: 'namespace' | 'class'): ScriptContext | undefined {
	const normalizedTargetPath = normalize(targetPath);
	const namespaceUri = pathToFileURL(namespaceDefinitionPath).toString();
	const lines = text.split(newLineRegExp);

	for (let i = 0; i < lines.length; i++) {
		const namespaceMatch = namespaceSignatureRegExp.exec(lines[i]);
		if (namespaceMatch === null)
			continue;

		let namespaceEndLine = i;
		for (; namespaceEndLine < lines.length; namespaceEndLine++) {
			if (lines[namespaceEndLine].trim() === '@endnamespace')
				break;
		}
		if (namespaceEndLine === lines.length)
			break;

		const namespaceName = namespaceMatch[1];
		const namespaceFolderPath = join(dirname(namespaceDefinitionPath), namespaceName);
		const implicitNamespace = namespaceName === '__default__' ? undefined : namespaceName;

		for (let j = i + 1; j < namespaceEndLine; j++) {
			if (expectedKind === 'namespace') {
				const fnMatch = functionSignatureRegExp.exec(lines[j]);
				if (fnMatch === null) continue;
				const fnPath = normalize(join(namespaceFolderPath, `${fnMatch[2]}.msc`));
				if (fnPath !== normalizedTargetPath) continue;
				return { implicitNamespace, parameters: parseSignatureParameters(lines[j], namespaceUri, j) };
			}

			const classMatch = classSignatureRegExp.exec(lines[j]);
			if (classMatch === null) continue;

			let classEndLine = j;
			for (; classEndLine < namespaceEndLine; classEndLine++) {
				if (lines[classEndLine].trim() === '@endclass')
					break;
			}
			if (classEndLine === namespaceEndLine)
				break;

			const className = classMatch[1];
			const classType = namespaceName === '__default__' ? className : `${namespaceName}::${className}`;
			for (let k = j + 1; k < classEndLine; k++) {
				const methodMatch = functionSignatureRegExp.exec(lines[k]);
				const constructorMatch = constructorSignatureRegExp.exec(lines[k]);
				if (methodMatch !== null) {
					const methodPath = normalize(join(namespaceFolderPath, className, `${methodMatch[2]}.msc`));
					if (methodPath === normalizedTargetPath) {
						return {
							thisType: classType,
							implicitNamespace,
							parameters: parseSignatureParameters(lines[k], namespaceUri, k)
						};
					}
				} else if (constructorMatch !== null) {
					const constructorSignature = getConstructorSignature(constructorMatch[1], constructorMatch[2]);
					const constructorPath = normalize(join(namespaceFolderPath, className, `${constructorSignature}.msc`));
					if (constructorPath === normalizedTargetPath) {
						return {
							thisType: classType,
							implicitNamespace,
							parameters: parseSignatureParameters(lines[k], namespaceUri, k)
						};
					}
				}
			}

			j = classEndLine;
		}

		i = namespaceEndLine;
	}

	return undefined;
}

async function resolveScriptContext(documentUri: string): Promise<ScriptContext> {
	const cached = scriptContextCache.get(documentUri);
	if (cached !== undefined) return cached;
	const result = await computeScriptContext(documentUri);
	scriptContextCache.set(documentUri, result);
	return result;
}

async function computeScriptContext(documentUri: string): Promise<ScriptContext> {
	let targetPath: string;
	try {
		targetPath = normalize(fileURLToPath(documentUri));
	} catch (_err) {
		return EMPTY_SCRIPT_CONTEXT;
	}

	const scriptFileName = basename(targetPath, extname(targetPath));
	if (scriptFileName === '__init__')
		return EMPTY_SCRIPT_CONTEXT;

	const scriptDirectoryPath = dirname(targetPath);
	const directNamespaceName = basename(scriptDirectoryPath);
	const directNamespaceDefinitionPath = join(dirname(scriptDirectoryPath), `${directNamespaceName}.nms`);

	// File directly inside a namespace folder: it's a namespace function. The
	// `.nms` signature contributes parameters but no implicit `this`.
	if (await fileExists(directNamespaceDefinitionPath)) {
		try {
			const text = await readFileAsync(directNamespaceDefinitionPath, 'utf8');
			return collectScriptContext(directNamespaceDefinitionPath, text, targetPath, 'namespace') ?? EMPTY_SCRIPT_CONTEXT;
		} catch (_err) {
			return EMPTY_SCRIPT_CONTEXT;
		}
	}

	// Otherwise it's nested under a class folder; the enclosing dir's `.nms`
	// owns the method/constructor signature (with implicit `this`).
	const enclosingNamespaceDirectoryPath = dirname(scriptDirectoryPath);
	const nestedNamespaceName = basename(enclosingNamespaceDirectoryPath);
	const nestedNamespaceDefinitionPath = join(dirname(enclosingNamespaceDirectoryPath), `${nestedNamespaceName}.nms`);

	try {
		const text = await readFileAsync(nestedNamespaceDefinitionPath, 'utf8');
		return collectScriptContext(nestedNamespaceDefinitionPath, text, targetPath, 'class') ?? EMPTY_SCRIPT_CONTEXT;
	} catch (_err) {
		return EMPTY_SCRIPT_CONTEXT;
	}
}

function skipStringForward(line: string, pos: number): number | undefined {
	const stack: string[] = [];
	for (; pos < line.length; pos++) {
		if (line[pos] === '"') {
			if (stack.length === 0 || stack[stack.length - 1] !== '"') {
				stack.push('"');
			} else if (pos === 0 || line[pos - 1] !== '\\') {
				stack.pop();
				if (stack.length === 0)
					return pos;
			}
		} else if (line[pos] === '{' && pos + 1 < line.length && line[pos + 1] === '{' &&
			(pos === 0 || line[pos - 1] !== '\\')) {
			if (stack.length !== 0 && stack[stack.length - 1] === '"') {
				stack.push('{');
			} else {
				return undefined;
			}
		} else if (line[pos] === '}' && pos + 1 < line.length && line[pos + 1] === '}' &&
			(pos === 0 || line[pos - 1] !== '\\')) {
			if (stack.length !== 0 && stack[stack.length - 1] === '{') {
				stack.pop();
			} else {
				return undefined;
			}
		}
	}
	return undefined;
}

function skipParenthesizedExpressionToEnd(lines: string[], startLine: number, endLine: number): number | undefined {
	const parenthesesStack: string[] = [];

	for (let line = startLine; line < endLine; line++) {
		for (let pos = 0; pos < lines[line].length; pos++) {
			const c = lines[line][pos];
			if (c === '"') {
				const newPos = skipStringForward(lines[line], pos);
				if (newPos === undefined)
					return undefined;
				pos = newPos;
			} else if (c === '(' || c === '[')
				parenthesesStack.push(c);
			else if (c === ')') {
				if (parenthesesStack.length === 0 || parenthesesStack[parenthesesStack.length - 1] !== '(')
					return undefined;
				parenthesesStack.pop();
			} else if (c === ']') {
				if (parenthesesStack.length === 0 || parenthesesStack[parenthesesStack.length - 1] !== '[')
					return undefined;
				parenthesesStack.pop();
			}
		}

		if (parenthesesStack.length === 0)
			return line;
	}

	return undefined;
}

function createLocation(uri: string, line: number, character: number): Location {
	return {
		uri: uri,
		range: {
			start: {
				line: line,
				character: character
			},
			end: {
				line: line,
				character: character
			}
		}
	};
}

function createFileLocation(path: string): Location {
	return createLocation(pathToFileURL(resolve(path)).toString(), 0, 0);
}

function getMemberDefinitionLocation(definition: DefinitionLocation | undefined): Location | undefined {
	if (definition === undefined)
		return undefined;
	return createLocation(definition.uri, definition.line, definition.character);
}

function isBuiltInDefinition(definitionUri: string | undefined): boolean {
	return definitionUri !== undefined && definitionUri === defaultNamespacesSourceUri;
}

async function getImplementationLocationForNamespaceFunction(namespaceName: string, functionName: string,
	definitionUri: string | undefined): Promise<Location | undefined> {
	if (definitionUri === undefined)
		return undefined;
	try {
		const namespaceDefinitionPath = fileURLToPath(definitionUri);
		const implementationPath = join(dirname(namespaceDefinitionPath), namespaceName, `${functionName}.msc`);
		if (await fileExists(implementationPath))
			return createFileLocation(implementationPath);
	} catch (_err) {
		return undefined;
	}
	return undefined;
}

async function getImplementationLocationForClassMember(currentClass: ClassInfo, currentMemberName: string,
	currentMemberKind: 'function' | 'constructor' | 'variable',
	definitionUri: string | undefined, signatureLabel: string | undefined): Promise<Location | undefined> {
	if (definitionUri === undefined)
		return undefined;
	try {
		const namespaceDefinitionPath = fileURLToPath(definitionUri);
		const classFolderPath = join(dirname(namespaceDefinitionPath), currentClass.namespaceName, currentClass.className);
		let implementationPath: string | undefined = undefined;
		if (currentMemberKind === 'function')
			implementationPath = join(classFolderPath, `${currentMemberName}.msc`);
		else if (currentMemberKind === 'constructor' && signatureLabel !== undefined) {
			const params = /\(.*\)/.exec(signatureLabel)?.[0];
			if (params !== undefined)
				implementationPath = join(classFolderPath, `${escapeFunctionName(getConstructorSignature(currentClass.className, params))}.msc`);
		}
		if (implementationPath !== undefined && await fileExists(implementationPath))
			return createFileLocation(implementationPath);
	} catch (_err) {
		return undefined;
	}
	return undefined;
}

async function getDefinitionLocationForSymbol(symbol: ResolvedSymbol): Promise<Location | undefined> {
	switch (symbol.kind) {
		case 'instanceMethod':
		case 'instanceField': {
			if (symbol.classInfo === undefined || symbol.member === undefined) {
				return undefined;
			}
			const currentMemberName = symbol.member.name.endsWith('()') ?
				symbol.member.name.substring(0, symbol.member.name.length - 2) : symbol.member.name;
			if (symbol.member.kind === 'function' && isBuiltInDefinition(symbol.member.definition?.uri)) {
				return undefined;
			}
			const implementationLocation = await getImplementationLocationForClassMember(
				symbol.classInfo,
				currentMemberName,
				symbol.member.kind,
				symbol.member.definition?.uri,
				symbol.member.signature?.label
			);
			return implementationLocation ?? getMemberDefinitionLocation(symbol.member.definition);
		}

		case 'namespaceFunction':
		case 'namespaceVariable': {
			if (symbol.member === undefined) {
				return undefined;
			}
			if (symbol.member.kind === 'function' && isBuiltInDefinition(symbol.member.definition?.uri)) {
				return undefined;
			}
			if (symbol.kind === 'namespaceFunction' && symbol.namespaceName !== undefined) {
				const functionName = symbol.member.name.substring(0, symbol.member.name.length - 2);
				const implementationLocation = await getImplementationLocationForNamespaceFunction(
					symbol.namespaceName,
					functionName,
					symbol.member.definition?.uri
				);
				if (implementationLocation !== undefined) {
					return implementationLocation;
				}
			}
			return getMemberDefinitionLocation(symbol.member.definition);
		}

		case 'classType':
		case 'constructor':
			return getMemberDefinitionLocation(symbol.classInfo?.definition ?? symbol.definition);

		case 'localVariable':
		case 'builtinVariable':
			if (symbol.definition !== undefined) {
				return getMemberDefinitionLocation(symbol.definition);
			}
			if (symbol.name === 'this') {
				return getMemberDefinitionLocation(classes.get(symbol.type)?.definition);
			}
			return undefined;

		default:
			return symbol.definition === undefined ? undefined : getMemberDefinitionLocation(symbol.definition);
	}
}

connection.onSignatureHelp(
	async (textDocumentPosition: SignatureHelpParams): Promise<SignatureHelp> => {
		const resolution = await getDocumentResolution(textDocumentPosition.textDocument.uri);

		const result: SignatureHelp = {
			signatures: [],
			activeSignature: 0,
			activeParameter: 0
		};

		const callContext = resolution.getCallContext(textDocumentPosition.position);
		if (callContext === undefined) {
			return result;
		}

		if (callContext.symbol.kind === 'namespaceFunction' && callContext.symbol.namespaceName !== undefined && callContext.symbol.member !== undefined) {
			const currentNamespace = namespaces.get(callContext.symbol.namespaceName);
			const signatures = currentNamespace?.memberSignatures.get(callContext.symbol.member.name);
			if (signatures !== undefined) {
				result.signatures = signatures.map(signature => ({ ...signature, activeParameter: callContext.paramNumber }));
			}
		} else if (callContext.symbol.kind === 'instanceMethod' && callContext.symbol.classInfo !== undefined && callContext.symbol.member !== undefined) {
			const signatures = callContext.symbol.classInfo.memberSignatures.get(callContext.symbol.member.name);
			if (signatures !== undefined) {
				result.signatures = signatures.map(signature => ({ ...signature, activeParameter: callContext.paramNumber }));
			}
		} else if (callContext.symbol.kind === 'constructor' && callContext.symbol.classInfo !== undefined) {
			const constructorName = callContext.symbol.name.includes('::')
				? callContext.symbol.name.substring(callContext.symbol.name.indexOf('::') + 2)
				: callContext.symbol.name;
			const signatures = callContext.symbol.classInfo.memberSignatures.get(constructorName);
			if (signatures !== undefined) {
				result.signatures = signatures.map(signature => ({ ...signature, activeParameter: callContext.paramNumber }));
			}
		}

		for (const signature of result.signatures) {
			signature.activeParameter = callContext.paramNumber;
		}
		return result;
	}
);

connection.onHover(
	async (textDocumentPosition: HoverParams): Promise<Hover | undefined> => {
		const resolution = await getDocumentResolution(textDocumentPosition.textDocument.uri);
		const reference = resolution.getReferenceAtPosition(textDocumentPosition.position);
		if (reference === undefined)
			return undefined;
		const hoverText = symbolToHoverText(reference.symbol, defaultNamespacesSourceUri);

		return {
			contents: {
				kind: MarkupKind.Markdown,
				value: [
					'```msc',
					hoverText.signature,
					'```'
				].join('\n') + (hoverText.documentation === undefined ? '' : '\n' + hoverText.documentation)
			}
		};
	}
);

connection.onDefinition(
	async (textDocumentPosition: DefinitionParams): Promise<Definition | undefined> => {
		const resolution = await getDocumentResolution(textDocumentPosition.textDocument.uri);
		const reference = resolution.getReferenceAtPosition(textDocumentPosition.position);
		if (reference === undefined)
			return undefined;
		return await getDefinitionLocationForSymbol(reference.symbol);
	}
);

connection.onCompletion(
	async (textDocumentPosition: TextDocumentPositionParams): Promise<CompletionItem[]> => {
		const resolution = await getDocumentResolution(textDocumentPosition.textDocument.uri);
		const completionContext = resolution.getCompletionContext(textDocumentPosition.position);

		switch (completionContext.kind) {
		case 'namespace': {
			const result: CompletionItem[] = [];
			for (const [namespaceName, _namespaceInfo] of namespaces) {
				if (namespaceName !== '__default__') {
					result.push({
						label: namespaceName,
						kind: CompletionItemKind.Module
					});
				}
			}
			return result;
		}

		case 'command':
			return minecraftCommands;

		case 'namespaceMembers': {
			if (completionContext.namespaceName === undefined) {
				return [];
			}
			const namespaceData = namespaces.get(completionContext.namespaceName);
			return namespaceData?.memberSuggestions ?? [];
		}

		case 'member': {
			if (completionContext.hostType === undefined) {
				return [];
			}
			const currentClassInfo = classes.get(completionContext.hostType);
			return currentClassInfo?.memberSuggestions ?? [];
		}

		case 'expression': {
			let result: CompletionItem[] = [];
			for (const binding of completionContext.visibleBindings ?? []) {
				result.push(makeCompletionItemForBinding(binding));
			}
			if (completionContext.activeNamespace !== undefined) {
				const currentNamespace = namespaces.get(completionContext.activeNamespace);
				if (currentNamespace !== undefined) {
					result = result.concat(currentNamespace.memberSuggestions);
				}
			}
			for (const [namespaceName, _namespaceInfo] of namespaces) {
				if (namespaceName !== '__default__') {
					result.push({
						label: namespaceName,
						kind: CompletionItemKind.Module,
						insertText: namespaceName + '::',
						command: {
							title: 'Trigger Suggest',
							command: 'editor.action.triggerSuggest'
						}
					});
				}
			}
			const defaultClasses = namespaces.get('__default__');
			if (defaultClasses !== undefined)
				result = result.concat(defaultClasses.memberSuggestions);
			return result;
		}

		default: {
			const document = documents.get(textDocumentPosition.textDocument.uri);
			if (document === undefined) {
				return [];
			}
			const line = document.getText({
				start: { line: textDocumentPosition.position.line, character: 0 },
				end: { line: textDocumentPosition.position.line, character: textDocumentPosition.position.character }
			});
			const keywordSuggestionRegExp = /^\s*(@)?[a-z]+$/;
			const keywordSuggestionRegExpRes = keywordSuggestionRegExp.exec(line);
			if (keywordSuggestionRegExpRes !== null) {
				return keywordSuggestionRegExpRes[1] === '@' ? keywordsWithoutAtSymbol : keywords;
			}
			return [];
		}
		}
	}
);

interface DefaultNamespacesPayload {
	text: string
	sourceUri: string
}

connection.onNotification('processDefaultNamespaces', (payload: DefaultNamespacesPayload) => {
	defaultNamespacesSourceUri = payload.sourceUri;
	parseNamespaceFile(payload.text, defaultNamespaces, defaultClasses, payload.sourceUri);
	defaultNamespaces.forEach((value, key) => namespaces.set(key, value));
	defaultClasses.forEach((value, key) => classes.set(key, value));
	documentResolutions.clear();
	defaultsLoaded = true;
	revalidateAllOpenDocuments();
});

interface NamespaceFunction {
	namespaceName: string,
	functionName: string,
	functionSignature: string
}
interface ClassConstructor {
	namespaceName: string,
	className: string,
	constructorSignature: string
}
interface ClassMethod {
	namespaceName: string,
	className: string,
	methodName: string,
	methodSignature: string
}
interface NamespaceUploadResult {
	name: string,
	namespaceDefinitionPath: string,
	defineScript: string,
	initializeScript: string,
	functions: NamespaceFunction[],
	constructors: ClassConstructor[],
	methods: ClassMethod[]
}

function getConstructorSignature(className: string, params: string): string {
	const paramsList = params.substring(1, params.length - 1).split(',');
	let result = className + '(';
	for (const param of paramsList)
		result += param.trim().split(' ')[0] + ',';
	result = result.substring(0, result.length - 1) + ')';
	return result;
}

interface UploadFileInfo {
	path: string,
	content: string,
	update: boolean, // only update or do full upload (for .nms files)
	clipboardMode: string
}

connection.onNotification('Export namespace', (fileInfo: UploadFileInfo) => {

	const result: NamespaceUploadResult[] = [];

	const lines = fileInfo.content.split(newLineRegExp);

	for (let i = 0; i < lines.length; i++) {
		const regExpRes = namespaceSignatureRegExp.exec(lines[i]);
		if (regExpRes === null)
			continue;
		let namespaceEndLine = i;
		for (namespaceEndLine = i; namespaceEndLine < lines.length; namespaceEndLine++) {
			if (lines[namespaceEndLine].trim() === '@endnamespace')
				break;
		}
		if (namespaceEndLine === lines.length)
			break;
		const namespaceName: string = regExpRes[1];
		const namespaceDefinitionsLines: string[] = [];
		const classDefinitionsLines: string[] = [];
		const memberDefinitionsLines: string[] = [];
		const variableDefinitionsLines: string[] = [];
		const variableInitializationsLines: string[] = [];
		const functions: NamespaceFunction[] = [];
		const methods: ClassMethod[] = [];
		const constructors: ClassConstructor[] = [];

		namespaceDefinitionsLines.push(`@bypass /namespace remove ${namespaceName}`);
		namespaceDefinitionsLines.push(`@bypass /namespace define ${namespaceName}`);

		for (let j = i + 1; j < namespaceEndLine; j++) {
			const classRegExpRes = classSignatureRegExp.exec(lines[j]);
			if (classRegExpRes !== null) {
				let classEndLine = j;
				for (; classEndLine < namespaceEndLine; classEndLine++) {
					if (lines[classEndLine].trim() === '@endclass')
						break;
				}
				if (classEndLine === namespaceEndLine)
					break;
				const className = classRegExpRes[1];
				classDefinitionsLines.push(`@bypass /type define ${namespaceName} ${className}`);

				for (let k = j + 1; k < classEndLine; k++) {
					const functionRegExpRes = functionSignatureRegExp.exec(lines[k]);
					const constructorRegExpRes = constructorSignatureRegExp.exec(lines[k]);
					const variableRegExpRes = variableSignatureRegExp.exec(lines[k]);
					if (functionRegExpRes !== null) {
						memberDefinitionsLines.push(`@bypass /type method define ${namespaceName} ${className} ${lines[k].trim()}`);
						methods.push({
							namespaceName: namespaceName,
							className: className,
							methodName: functionRegExpRes[2],
							methodSignature: functionRegExpRes[2] + functionRegExpRes[3]
						});
					} else if (constructorRegExpRes !== null) {
						memberDefinitionsLines.push(`@bypass /type constructor define ${namespaceName} ${lines[k].trim()}`);
						constructors.push({
							namespaceName: namespaceName,
							className: className,
							constructorSignature: getConstructorSignature(constructorRegExpRes[1], constructorRegExpRes[2])
						});
					} else if (variableRegExpRes !== null) {
						const fieldDeclarationEndLine = skipParenthesizedExpressionToEnd(lines, k, classEndLine);
						if (fieldDeclarationEndLine === undefined)
							continue;

						if (variableRegExpRes[7] !== undefined) {
							const fieldIntialization: string = variableRegExpRes[7] + ' ' + lines.slice(k + 1, fieldDeclarationEndLine + 1)
								.map((value: string): string => value.trim())
								.join(' ');
							variableInitializationsLines.push(`@bypass /type field set ${namespaceName} ${className} ${variableRegExpRes[6]} ${fieldIntialization}`);
						}

						k = fieldDeclarationEndLine;
						memberDefinitionsLines.push(`@bypass /type field define ${namespaceName} ${className} ${variableRegExpRes[1]}`);

					}
				}

				j = classEndLine;
				continue;
			}
			const functionRegExpRes = functionSignatureRegExp.exec(lines[j]);
			const variableRegExpRes = variableSignatureRegExp.exec(lines[j]);
			if (functionRegExpRes !== null) {
				memberDefinitionsLines.push(`@bypass /function define ${namespaceName} ${lines[j].trim()}`);
				functions.push({
					namespaceName: namespaceName,
					functionName: functionRegExpRes[2],
					functionSignature: functionRegExpRes[2] + functionRegExpRes[3]
				});
			} else if (variableRegExpRes !== null) {
				const variableDeclarationEndLine = skipParenthesizedExpressionToEnd(lines, j, namespaceEndLine);
				if (variableDeclarationEndLine === undefined)
					continue;

				if (variableRegExpRes[7] !== undefined) {
					const variableInitialization: string = variableRegExpRes[7] + ' ' + lines.slice(j + 1, variableDeclarationEndLine + 1)
						.map((value: string): string => value.trim())
						.join(' ');
					variableInitializationsLines.push(`@bypass /variable set ${namespaceName} ${variableRegExpRes[6]} ${variableInitialization}`);
				}

				j = variableDeclarationEndLine;
				variableDefinitionsLines.push(`@bypass /variable define ${namespaceName} ${variableRegExpRes[1]}`);

			}
		}

		i = namespaceEndLine;

		const defineScript: string = (fileInfo.update) ? '' :
			namespaceDefinitionsLines.concat([''])
				.concat(classDefinitionsLines)
				.concat(memberDefinitionsLines)
				.concat(variableDefinitionsLines).join('\n');
		const initializeScript: string = variableInitializationsLines.join('\n');
		const currentNamespace: NamespaceUploadResult = {
			name: namespaceName,
			namespaceDefinitionPath: fileInfo.path,
			defineScript: defineScript,
			initializeScript: initializeScript,
			functions: functions,
			constructors: constructors,
			methods: methods
		};
		result.push(currentNamespace);
	}

	connection.sendNotification('Upload namespace script', {
		namespaces: result,
		clipboardMode: fileInfo.clipboardMode
	});
});

interface ResolveImportContextsParams {
	namespaceDefinitionPath: string,
	contents: string,
	scriptPath: string
}

interface FunctionImportContext {
	kind: 'function',
	namespaceName: string,
	functionSignature: string
}

interface ConstructorImportContext {
	kind: 'constructor',
	namespaceName: string,
	constructorSignature: string
}

interface MethodImportContext {
	kind: 'method',
	namespaceName: string,
	className: string,
	methodSignature: string
}

type ScriptImportContext = FunctionImportContext | ConstructorImportContext | MethodImportContext;

function escapeFunctionName(name: string): string {
	return name.replace(/::/g, '__');
}

function getScriptChildPath(namespaceFolderPath: string, relativePath: string): string {
	return resolve(join(namespaceFolderPath, escapeFunctionName(relativePath)));
}

connection.onRequest('Resolve import contexts', (params: ResolveImportContextsParams): ScriptImportContext[] => {
	const targetPath = resolve(params.scriptPath);
	const lines = params.contents.split(newLineRegExp);
	const contexts: ScriptImportContext[] = [];

	for (let i = 0; i < lines.length; i++) {
		const namespaceMatch = namespaceSignatureRegExp.exec(lines[i]);
		if (namespaceMatch === null) {
			continue;
		}

		let namespaceEndLine = i;
		for (; namespaceEndLine < lines.length; namespaceEndLine++) {
			if (lines[namespaceEndLine].trim() === '@endnamespace') {
				break;
			}
		}
		if (namespaceEndLine === lines.length) {
			break;
		}

		const namespaceName = namespaceMatch[1];
		const namespaceFolderPath = join(dirname(params.namespaceDefinitionPath), namespaceName);

		for (let j = i + 1; j < namespaceEndLine; j++) {
			const classMatch = classSignatureRegExp.exec(lines[j]);
			if (classMatch !== null) {
				let classEndLine = j;
				for (; classEndLine < namespaceEndLine; classEndLine++) {
					if (lines[classEndLine].trim() === '@endclass') {
						break;
					}
				}
				if (classEndLine === namespaceEndLine) {
					break;
				}

				const className = classMatch[1];
				for (let k = j + 1; k < classEndLine; k++) {
					const methodMatch = functionSignatureRegExp.exec(lines[k]);
					const constructorMatch = constructorSignatureRegExp.exec(lines[k]);

					if (methodMatch !== null) {
						const methodPath = getScriptChildPath(namespaceFolderPath, `${className}/${methodMatch[2]}.msc`);
						if (methodPath === targetPath) {
							contexts.push({
								kind: 'method',
								namespaceName,
								className,
								methodSignature: methodMatch[2] + methodMatch[3]
							});
						}
					} else if (constructorMatch !== null) {
						const constructorSignature = getConstructorSignature(constructorMatch[1], constructorMatch[2]);
						const constructorPath = getScriptChildPath(namespaceFolderPath, `${className}/${constructorSignature}.msc`);
						if (constructorPath === targetPath) {
							contexts.push({
								kind: 'constructor',
								namespaceName,
								constructorSignature
							});
						}
					}
				}

				j = classEndLine;
				continue;
			}

			const functionMatch = functionSignatureRegExp.exec(lines[j]);
			if (functionMatch !== null) {
				const functionPath = getScriptChildPath(namespaceFolderPath, `${functionMatch[2]}.msc`);
				if (functionPath === targetPath) {
					contexts.push({
						kind: 'function',
						namespaceName,
						functionSignature: functionMatch[2] + functionMatch[3]
					});
				}
			}
		}

		i = namespaceEndLine;
	}

	return contexts;
});

connection.onCodeAction((params: CodeActionParams) => {
	const textDocument = documents.get(params.textDocument.uri);
	if (!textDocument) {
		return [];
	}

	const actions: CodeAction[] = [];
	for (const diagnostic of params.context.diagnostics) {
		actions.push(...buildRuleFixes(textDocument, diagnostic));
		actions.push(ignoreThisErrorAction(textDocument, diagnostic));
		const similar = ignoreSimilarInFileAction(textDocument, diagnostic);
		if (similar) actions.push(similar);
		actions.push(disableErrorCheckingInFileAction(textDocument, diagnostic));
	}
	return actions;
});

function diagnosticCode(diagnostic: Diagnostic): string | undefined {
	return typeof diagnostic.code === 'string' ? diagnostic.code : undefined;
}

function insertAtTopEdit(doc: TextDocument, diagnostic: Diagnostic, title: string, marker: string): CodeAction {
	return {
		title,
		kind: CodeActionKind.QuickFix,
		diagnostics: [diagnostic],
		edit: {
			documentChanges: [{
				textDocument: { uri: doc.uri, version: doc.version },
				edits: [{
					range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
					newText: marker + '\n'
				}]
			}]
		}
	};
}

function ignoreThisErrorAction(doc: TextDocument, diagnostic: Diagnostic): CodeAction {
	const line = diagnostic.range.start.line;
	const code = diagnosticCode(diagnostic);
	const marker = code ? `# msc-ignore ${code}` : '# msc-ignore';
	return {
		title: 'Ignore this error',
		kind: CodeActionKind.QuickFix,
		diagnostics: [diagnostic],
		edit: {
			documentChanges: [{
				textDocument: { uri: doc.uri, version: doc.version },
				edits: [{
					range: { start: { line, character: 0 }, end: { line, character: 0 } },
					newText: marker + '\n'
				}]
			}]
		}
	};
}

function ignoreSimilarInFileAction(doc: TextDocument, diagnostic: Diagnostic): CodeAction | null {
	const code = diagnosticCode(diagnostic);
	if (!code) return null;
	return insertAtTopEdit(doc, diagnostic, 'Ignore this error and others like it', `# msc-ignore file ${code}`);
}

function disableErrorCheckingInFileAction(doc: TextDocument, diagnostic: Diagnostic): CodeAction {
	return insertAtTopEdit(doc, diagnostic, 'Disable error checking in this file', '# msc-ignore file');
}

function buildRuleFixes(doc: TextDocument, diagnostic: Diagnostic): CodeAction[] {
	const code = typeof diagnostic.code === 'string' ? diagnostic.code : undefined;
	const rule = code ? RULES[code] : undefined;

	const attached = (diagnostic.data as DiagnosticData | undefined)?.fix;
	let result: Fix | Fix[] | null | undefined = attached;

	if (!result && rule?.fix) {
		const line = diagnostic.range.start.line;
		const lineText = doc.getText({
			start: { line, character: 0 },
			end: { line: line + 1, character: 0 }
		}).replace(/\r?\n$/, '');
		result = rule.fix({ lineText, line, totalLines: doc.lineCount });
	}
	if (!result) return [];
	const fixes = Array.isArray(result) ? result : [result];
	return fixes.map(fix => ({
		title: fix.title,
		kind: CodeActionKind.QuickFix,
		diagnostics: [diagnostic],
		edit: {
			documentChanges: [{
				textDocument: { uri: doc.uri, version: doc.version },
				edits: lineOpsToEdits(fix.edits)
			}]
		}
	}));
}

interface IfScriptBlock {
	readonly type: 'if';
	readonly line: number;
	hadElse: boolean;
}

interface ForScriptBlock {
	readonly type: 'for';
	readonly line: number;
}

interface ReturnScriptBlock {
	readonly type: 'return';
	readonly line: number;
}

type NestedScriptBlock = IfScriptBlock | ForScriptBlock | ReturnScriptBlock;

class ScriptParsingContext {
	readonly blockStack: NestedScriptBlock[] = [];
	returnCount = 0;
	inHeader = true;

	currentScopeHadReturn(): boolean {
		return this.returnCount > 0;
	}

	push(block: NestedScriptBlock) {
		this.blockStack.push(block);
	}

	pop(): NestedScriptBlock | undefined {
		return this.blockStack.pop();
	}

	last(): NestedScriptBlock | undefined {
		return this.blockStack[this.blockStack.length - 1];
	}

	pushReturn(line: number) {
		this.blockStack.push({
			type: 'return',
			line: line
		});
		this.returnCount++;
	}

	popReturns() {
		while (this.last()?.type === 'return') {
			this.blockStack.pop();
			this.returnCount--;
		}
	}
}

const validStarters = [
	'@if', '@elseif', '@else', '@fi', '@for', '@done', '@define', '@var',
	'@player', '@chatscript', '@prompt', '@delay', '@command', '@bypass',
	'@console', '@cooldown', '@global_cooldown', '@using', '@cancel',
	'@fast', '@slow', '@return'
];

function closestScriptOperator(word: string): string | undefined {
	let best: string | undefined;
	let bestDistance = Infinity;
	for (const candidate of validStarters) {
		const d = editDistance(word, candidate);
		if (d < bestDistance) {
			bestDistance = d;
			best = candidate;
		}
	}
	return best !== undefined && bestDistance <= 2 ? best : undefined;
}

function editDistance(a: string, b: string): number {
	const m = a.length, n = b.length;
	if (m === 0) return n;
	if (n === 0) return m;
	let prev = new Array(n + 1);
	let curr = new Array(n + 1);
	for (let j = 0; j <= n; j++) prev[j] = j;
	for (let i = 1; i <= m; i++) {
		curr[0] = i;
		for (let j = 1; j <= n; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
		}
		[prev, curr] = [curr, prev];
	}
	return prev[n];
}

const HEADER_OPERATORS: ReadonlySet<string> = new Set([
	'@using', '@chatscript', '@cooldown', '@global_cooldown', '@cancel',
	'@slow', '@fast'
]);

const HEADER_RESTRICTED_OPERATORS: ReadonlySet<string> = new Set([
	'@cooldown', '@global_cooldown', '@cancel'
]);

const RESERVED_VARIABLE_NAMES: ReadonlySet<string> = new Set([
	'true', 'false', 'this', 'null', 'final', 'relative', 'private', 'pi'
]);

type ScriptCommandExecutor = 'bypass' | 'command' | 'console';

interface ScriptCommandInfo {
	executor: ScriptCommandExecutor;
	command: string;
}

function getScriptCommandInfo(trimmedLine: string): ScriptCommandInfo | null {
	const match = /^@(bypass|command|console)\s+(.+)$/.exec(trimmedLine);
	if (!match) return null;

	let command = match[2];
	if (command.startsWith('/')) {
		command = command.substring(1);
	}

	command = command.replace(/^(\w+:)?/, '');
	if (command.startsWith('c ')) {
		command = 'checkpoint' + command.substring(1);
	} else if (command.startsWith('cp ')) {
		command = 'checkpoint' + command.substring(2);
	}

	return {
		executor: match[1] as ScriptCommandExecutor,
		command
	};
}

function isValidVariableTag(variableName: string): boolean {
	return /^[a-z][a-zA-Z0-9_]*$/.test(variableName) && !RESERVED_VARIABLE_NAMES.has(variableName);
}

function validateTime(str: string, lineNumber: number, startIndex: number, endIndex: number, diagnostics: Diagnostic[]) {
	if (!str.match(/^\d+[smhdwy]?$/i)) {
		raise(diagnostics, RULES.SYN010, {
			start: { line: lineNumber, character: startIndex },
			end: { line: lineNumber, character: endIndex }
		});
	}
}

function validateScriptOperatorSyntax(trimmedLine: string, firstWord: string, lineNumber: number, lineStartIndex: number, lineLength: number, lineText: string, diagnostics: Diagnostic[]) {
	if (!validStarters.includes(firstWord)) {
		const suggestion = closestScriptOperator(firstWord);
		const fix: Fix | undefined = suggestion === undefined ? undefined : {
			title: `Replace with ${suggestion}`,
			edits: [{ kind: 'replace', line: lineNumber, content: lineText.replace(firstWord, suggestion) }]
		};
		raise(diagnostics, RULES.SYN003, {
			start: { line: lineNumber, character: lineStartIndex },
			end: { line: lineNumber, character: lineStartIndex + firstWord.length }
		}, {
			message: suggestion === undefined
				? `Invalid script option ${firstWord}`
				: `Invalid script option ${firstWord}. Did you mean ${suggestion}?`,
			fix
		});
		return;
	}

	const commandInfo = getScriptCommandInfo(trimmedLine);
	if (commandInfo !== null) {
		if (/^(op|deop|rank|lp|luckperms|permissions|perms|perm)(\s|$)/.test(commandInfo.command)) {
			raise(diagnostics, RULES.SEC002, {
				start: { line: lineNumber, character: lineStartIndex },
				end: { line: lineNumber, character: lineLength }
			});
		}

		if ((commandInfo.executor === 'bypass' || commandInfo.executor === 'console') && /^(script|s)(\s|$)/.test(commandInfo.command)) {
			raise(diagnostics, RULES.SEC001, {
				start: { line: lineNumber, character: lineStartIndex },
				end: { line: lineNumber, character: lineLength }
			});
		}

		if ((commandInfo.executor === 'command' || commandInfo.executor === 'bypass') &&
			/^(chat|gchat|alert|echat|achat|schat|bchat|pchat|tchat|p|t)\s/.test(commandInfo.command)) {
			raise(diagnostics, RULES.SEC003, {
				start: { line: lineNumber, character: lineStartIndex },
				end: { line: lineNumber, character: lineLength }
			});
		}

		if (commandInfo.command.startsWith('{{')) {
			raise(diagnostics, RULES.SEC004, {
				start: { line: lineNumber, character: lineStartIndex },
				end: { line: lineNumber, character: lineLength }
			});
		}
	}

	switch (firstWord) {
		case '@else':
		case '@fi':
		case '@done': {
			if (trimmedLine !== firstWord) {
				raise(diagnostics, RULES.SYN004, {
					start: { line: lineNumber, character: lineStartIndex + firstWord.length },
					end: { line: lineNumber, character: lineLength }
				}, { message: `${firstWord} should be on its own line` });
			}
			break;
		}

		case '@if':
		case '@elseif': {
			const ifRegex = /^@(if|elseif)\s+(.+)$/;
			if (!trimmedLine.match(ifRegex)) {
				raise(diagnostics, RULES.SYN005, {
					start: { line: lineNumber, character: lineStartIndex + firstWord.length },
					end: { line: lineNumber, character: lineLength }
				}, { message: `${firstWord} requires a non-empty condition` });
			}
			break;
		}

		case '@for': {
			const forRegex = RegExp(/^@for\s+([\w:]+)\s+(\w+)\s+in\s+(.+)$/, 'd');
			const forMatch = trimmedLine.match(forRegex);
			if (!forMatch) {
				raise(diagnostics, RULES.SYN006, {
					start: { line: lineNumber, character: lineStartIndex },
					end: { line: lineNumber, character: lineLength }
				});
				break;
			}

			const [_all, _variableType, variableName, _initializer] = forMatch;
			if (!isValidVariableTag(variableName)) {
				raise(diagnostics, RULES.STY001, {
					start: { line: lineNumber, character: lineStartIndex + forMatch.indices![2][0] },
					end: { line: lineNumber, character: lineStartIndex + forMatch.indices![2][1] }
				});
			}
			break;
		}

		case '@define': {
			const defineRegex = RegExp(/^@define\s+([\w:[\]]+)\s+([\w]+)\s*(=\s*(.+)?)?$/, 'd');
			const defineMatch = trimmedLine.match(defineRegex);
			if (!defineMatch) {
				raise(diagnostics, RULES.SYN007, {
					start: { line: lineNumber, character: lineStartIndex },
					end: { line: lineNumber, character: lineLength }
				});
				break;
			}

			const [_all, _variableType, variableName, intializer, initializerExpression] = defineMatch;
			if (!isValidVariableTag(variableName)) {
				raise(diagnostics, RULES.STY001, {
					start: { line: lineNumber, character: lineStartIndex + defineMatch.indices![2][0] },
					end: { line: lineNumber, character: lineStartIndex + defineMatch.indices![2][1] }
				});
			}
			if (intializer !== undefined && initializerExpression === undefined) {
				raise(diagnostics, RULES.SYN008, {
					start: { line: lineNumber, character: lineStartIndex + defineMatch.indices![3][1] },
					end: { line: lineNumber, character: lineLength }
				});
			}
			break;
		}

		case '@chatscript': {
			const chatscriptRegex = RegExp(/^@chatscript\s+(\S+)\s+(\S+)\s+(.+)$/, 'd');
			const chatscriptMatch = trimmedLine.match(chatscriptRegex);
			if (!chatscriptMatch) {
				raise(diagnostics, RULES.SYN009, {
					start: { line: lineNumber, character: lineStartIndex },
					end: { line: lineNumber, character: lineLength }
				});
				break;
			}

			const [_all, time, _group, _expression] = chatscriptMatch;
			validateTime(time, lineNumber, lineStartIndex + chatscriptMatch.indices![1][0], lineStartIndex + chatscriptMatch.indices![1][1], diagnostics);
			break;
		}

		case '@cooldown':
		case '@global_cooldown': {
			const cooldownMatch = trimmedLine.match(RegExp(/^@(cooldown|global_cooldown)\s+(\S+)$/, 'd'));
			if (!cooldownMatch) {
				raise(diagnostics, RULES.SYN012, {
					start: { line: lineNumber, character: lineStartIndex },
					end: { line: lineNumber, character: lineLength }
				}, { message: `Invalid ${firstWord} syntax: expected\n${firstWord} time` });
			} else {
				validateTime(cooldownMatch[2], lineNumber, lineStartIndex + cooldownMatch.indices![2][0], lineStartIndex + cooldownMatch.indices![2][1], diagnostics);
			}
			break;
		}

		case '@cancel': {
			if (trimmedLine !== '@cancel') {
				raise(diagnostics, RULES.SYN004, {
					start: { line: lineNumber, character: lineStartIndex + firstWord.length },
					end: { line: lineNumber, character: lineLength }
				}, { message: '@cancel should be on its own line' });
			}
			break;
		}

		case '@delay': {
			const delayMatch = trimmedLine.match(RegExp(/^@delay\s+(\S+)$/, 'd'));
			if (!delayMatch) {
				raise(diagnostics, RULES.SYN013, {
					start: { line: lineNumber, character: lineStartIndex },
					end: { line: lineNumber, character: lineLength }
				});
			} else {
				validateTime(delayMatch[1], lineNumber, lineStartIndex + delayMatch.indices![1][0], lineStartIndex + delayMatch.indices![1][1], diagnostics);
			}
			break;
		}

		case '@prompt': {
			const promptMatch = trimmedLine.match(RegExp(/^@prompt\s+(\S+)\s+(\S+)(?:\s+.*)?$/, 'd'));
			if (!promptMatch) {
				raise(diagnostics, RULES.SYN011, {
					start: { line: lineNumber, character: lineStartIndex },
					end: { line: lineNumber, character: lineLength }
				});
			} else {
				validateTime(promptMatch[1], lineNumber, lineStartIndex + promptMatch.indices![1][0], lineStartIndex + promptMatch.indices![1][1], diagnostics);
			}
			break;
		}

		case '@slow':
		case '@fast': {
			if (trimmedLine !== '@slow' && trimmedLine !== '@fast') {
				raise(diagnostics, RULES.SYN004, {
					start: { line: lineNumber, character: lineStartIndex + firstWord.length },
					end: { line: lineNumber, character: lineLength }
				}, { message: `${firstWord} should be on its own line` });
			}
			break;
		}

		case '@using': {
			const usingRegex = /^@using\s+(\w+)$/;
			if (!trimmedLine.match(usingRegex)) {
				raise(diagnostics, RULES.SYN014, {
					start: { line: lineNumber, character: lineStartIndex },
					end: { line: lineNumber, character: lineLength }
				});
			}
			break;
		}

		case '@bypass':
		case '@command':
		case '@console': {
			const bypassCommandConsoleRegex = /^@(bypass|command|console)\s+(.+)$/;
			if (!trimmedLine.match(bypassCommandConsoleRegex)) {
				raise(diagnostics, RULES.SYN015, {
					start: { line: lineNumber, character: lineStartIndex },
					end: { line: lineNumber, character: lineLength }
				}, { message: `Invalid ${firstWord} syntax: expected\n${firstWord} /command` });
			}
			break;
		}
	}
}

function processControlStatements(firstWord: string, lineNumber: number, lineStartIndex: number, lineLength: number, lineText: string, parsingContext: ScriptParsingContext, diagnostics: Diagnostic[]) {
	const currentScopeHadReturnBeforeThisLine = parsingContext.currentScopeHadReturn();
	const duplicateReturn = firstWord === '@return' && currentScopeHadReturnBeforeThisLine;

	switch (firstWord) {
		case '@if': {
			parsingContext.push({
				type: 'if',
				line: lineNumber,
				hadElse: false
			});
			break;
		}

		case '@for': {
			parsingContext.push({
				type: 'for',
				line: lineNumber,
			});
			break;
		}

		case '@fi':
		case '@done': {
			parsingContext.popReturns();
			const lastBlock: NestedScriptBlock | undefined = parsingContext.pop();
			if (lastBlock === undefined) {
				raise(diagnostics, RULES.SYN016, {
					start: { line: lineNumber, character: lineStartIndex },
					end: { line: lineNumber, character: lineStartIndex + firstWord.length }
				}, { message: `${firstWord} without matching ${firstWord === '@fi' ? '@if' : '@for'}` });
			} else {
				if ((firstWord === '@fi' && lastBlock.type !== 'if') ||
					(firstWord === '@done' && lastBlock.type !== 'for')) {
					const expected = lastBlock.type === 'if' ? '@fi' : '@done';
					raise(diagnostics, RULES.SYN017, {
						start: { line: lineNumber, character: lineStartIndex },
						end: { line: lineNumber, character: lineStartIndex + firstWord.length }
					}, {
						message: `Mismatched ${firstWord}: expected ${expected}`,
						fix: {
							title: `Replace with ${expected}`,
							edits: [{ kind: 'replace', line: lineNumber, content: lineText.replace(firstWord, expected) }]
						}
					});
				}
			}
			break;
		}
		case '@elseif':
		case '@else': {
			parsingContext.popReturns();
			const lastBlock: NestedScriptBlock | undefined = parsingContext.last();
			if (lastBlock?.type !== 'if') {
				raise(diagnostics, RULES.SYN018, {
					start: { line: lineNumber, character: lineStartIndex },
					end: { line: lineNumber, character: lineStartIndex + firstWord.length }
				}, { message: `Mismatched ${firstWord}: no matching @if` });
			} else {
				if (lastBlock.hadElse) {
					const diagnosticMessage = firstWord === '@else' ? 'Multiple @else in @if-@fi block' : '@elseif can\'t occur after @else in @if-@fi block';
					raise(diagnostics, RULES.SYN019, {
						start: { line: lineNumber, character: lineStartIndex },
						end: { line: lineNumber, character: lineStartIndex + firstWord.length }
					}, { message: diagnosticMessage });
				}
				if (firstWord === '@else') {
					lastBlock.hadElse = true;
				}
			}
			break;
		}

		case '@return': {
			if (duplicateReturn) {
				raise(diagnostics, RULES.SYN021, {
					start: { line: lineNumber, character: lineStartIndex },
					end: { line: lineNumber, character: lineStartIndex + firstWord.length }
				});
			}
			parsingContext.pushReturn(lineNumber);
			break;
		}
	}

	if ((firstWord !== '@return' && parsingContext.currentScopeHadReturn()) || (firstWord === '@return' && currentScopeHadReturnBeforeThisLine && !duplicateReturn)) {
		raise(diagnostics, RULES.STY002, {
			start: { line: lineNumber, character: 0 },
			end: { line: lineNumber, character: lineLength }
		});
	}
}

function validateHeaderPosition(firstWord: string, lineNumber: number, lineStartIndex: number, lineLength: number, parsingContext: ScriptParsingContext, diagnostics: Diagnostic[]) {
	if (HEADER_RESTRICTED_OPERATORS.has(firstWord) && !parsingContext.inHeader) {
		raise(diagnostics, RULES.SYN020, {
			start: { line: lineNumber, character: lineStartIndex },
			end: { line: lineNumber, character: lineLength }
		}, { message: `${firstWord} must appear in the header, before any executable statement` });
	}

	if (!HEADER_OPERATORS.has(firstWord)) {
		parsingContext.inHeader = false;
	}
}

function processLine(line: string, lineNumber: number, parsingContext: ScriptParsingContext, diagnostics: Diagnostic[]) {
	const trimmedLine = line.trim();

	if (trimmedLine === '' || trimmedLine.startsWith('# ') || trimmedLine === '#') {
		return;
	}

	if (trimmedLine.startsWith('#')) {
		const hashIndex = line.indexOf('#');
		raise(diagnostics, RULES.SYN024, {
			start: { line: lineNumber, character: hashIndex },
			end: { line: lineNumber, character: line.length }
		}, {
			fix: {
				title: 'Insert space after #',
				edits: [{ kind: 'replace', line: lineNumber, content: `${line.slice(0, hashIndex + 1)} ${line.slice(hashIndex + 1)}` }]
			}
		});
		return;
	}

	const firstWord = trimmedLine.split(" ")[0];
	const lineStartIndex = line.indexOf(firstWord);

	validateScriptOperatorSyntax(trimmedLine, firstWord, lineNumber, lineStartIndex, line.length, line, diagnostics);
	processControlStatements(firstWord, lineNumber, lineStartIndex, line.length, line, parsingContext, diagnostics);
	validateHeaderPosition(firstWord, lineNumber, lineStartIndex, line.length, parsingContext, diagnostics);
}

interface ExtractedExpression {
	text: string;
	startCharacter: number;
}

function extractExpressionAfterKeyword(line: string, keyword: string): ExtractedExpression | null {
	const keywordIndex = line.indexOf(keyword);
	if (keywordIndex === -1) return null;
	const startCharacter = keywordIndex + keyword.length;
	const text = line.slice(startCharacter).trimStart();
	if (text === '') return null;
	return {
		text,
		startCharacter: startCharacter + (line.slice(startCharacter).length - text.length)
	};
}

function findTopLevelAssignment(line: string): { left: string; operator: string; right: string; startCharacter: number } | null {
	const candidates = [' *= ', ' /= ', ' %= ', ' += ', ' -= ', ' = '];
	let parenDepth = 0;
	let bracketDepth = 0;
	let inString = false;

	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (c === '"') {
			inString = !inString;
			continue;
		}
		if (inString) continue;
		if (c === '(') parenDepth++;
		else if (c === ')') parenDepth = Math.max(0, parenDepth - 1);
		else if (c === '[') bracketDepth++;
		else if (c === ']') bracketDepth = Math.max(0, bracketDepth - 1);

		if (parenDepth !== 0 || bracketDepth !== 0) continue;

		for (const candidate of candidates) {
			if (!line.startsWith(candidate, i)) continue;
			const left = line.slice(0, i).trim();
			const right = line.slice(i + candidate.length).trim();
			if (left === '' || right === '') return null;
			return {
				left,
				operator: candidate.trim().replace('=', ''),
				right,
				startCharacter: i + (line.slice(0, i).length - line.slice(0, i).trimStart().length)
			};
		}
	}

	return null;
}

function collectSemanticExpressions(line: string, lineNumber: number, resolution: DocumentResolution): ExtractedExpression[] {
	const trimmedLine = line.trim();
	if (trimmedLine === '' || trimmedLine.startsWith('#')) {
		return [];
	}

	const firstWord = trimmedLine.split(' ')[0];
	const expressions: ExtractedExpression[] = [];

	switch (firstWord) {
		case '@if':
		case '@elseif': {
			const extracted = extractExpressionAfterKeyword(line, firstWord);
			if (extracted) expressions.push(extracted);
			break;
		}

		case '@for': {
			const forMatch = line.match(RegExp(/^\s*@for\s+[\w:]+\s+\w+\s+in\s+(.+)$/, 'd'));
			if (forMatch) {
				expressions.push({
					text: forMatch[1],
					startCharacter: forMatch.indices![1][0]
				});
			}
			break;
		}

		case '@define': {
			const defineMatch = line.match(RegExp(/^\s*@define\s+[\w:[\]]+\s+[\w]+\s*=\s*(.+)$/, 'd'));
			if (defineMatch) {
				expressions.push({
					text: defineMatch[1],
					startCharacter: defineMatch.indices![1][0]
				});
			}
			break;
		}

		case '@return': {
			const extracted = extractExpressionAfterKeyword(line, '@return');
			if (extracted) expressions.push(extracted);
			break;
		}

		case '@var': {
			const extracted = extractExpressionAfterKeyword(line, '@var');
			if (!extracted) break;

			const assignment = findTopLevelAssignment(extracted.text);
			if (assignment && assignment.operator !== '') {
				expressions.push({
					text: `${assignment.left} ${assignment.operator} ${assignment.right}`,
					startCharacter: extracted.startCharacter
				});
			} else if (assignment) {
				expressions.push({
					text: assignment.right,
					startCharacter: extracted.startCharacter + extracted.text.indexOf(assignment.right)
				});
			} else {
				expressions.push(extracted);
			}
			break;
		}

		case '@chatscript': {
			const chatscriptMatch = line.match(RegExp(/^\s*@chatscript\s+\S+\s+\S+\s+(.+)$/, 'd'));
			if (chatscriptMatch) {
				expressions.push({
					text: chatscriptMatch[1],
					startCharacter: chatscriptMatch.indices![1][0]
				});
			}
			break;
		}
	}

	for (const token of resolution.tokens) {
		if (token.line !== lineNumber || token.kind !== 'interpolation') continue;
		expressions.push({
			text: token.text.slice(2, -2),
			startCharacter: token.range.start.character + 2
		});
	}

	return expressions;
}

function validateSemanticExpressions(lines: readonly string[], resolution: DocumentResolution, diagnostics: Diagnostic[]) {
	for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
		for (const expression of collectSemanticExpressions(lines[lineNumber], lineNumber, resolution)) {
			const analysis = resolution.analyzeExpression(expression.text, lineNumber, expression.startCharacter);
			for (const diagnostic of analysis.diagnostics) {
				const rule = (diagnostic.code && RULES[diagnostic.code]) || RULES.SEM001;
				raise(diagnostics, rule, diagnostic.range, { message: diagnostic.message });
			}
		}
	}
}

function validateDeclaredTypes(resolution: DocumentResolution, diagnostics: Diagnostic[]) {
	for (const reference of resolution.references) {
		if (reference.token.kind !== 'typeName' || reference.symbol.kind !== 'unresolved') continue;
		raise(diagnostics, RULES.SEM002, reference.token.range, {
			message: `Unknown type: ${reference.token.text}`
		});
	}
}

function validateMemberAccess(lines: readonly string[], resolution: DocumentResolution, diagnostics: Diagnostic[]) {
	for (const reference of resolution.references) {
		if (reference.symbol.kind !== 'unresolved') continue;
		const hostType = resolution.getMemberAccessHostType(reference.token.range.start);
		if (hostType === undefined) continue;
		if (resolution.hasMember(hostType, reference.token.text + '()')) {
			raise(diagnostics, RULES.SEM020, reference.token.range, {
				message: `'${reference.token.text}' is a method on ${hostType}; call it with ()`
			});
			continue;
		}
		const suggestion = closestName(reference.token.text, resolution.getMemberNames(hostType));
		const lineText = lines[reference.token.line] ?? '';
		raise(diagnostics, RULES.SEM003, reference.token.range, {
			message: suggestion === undefined
				? `Type '${hostType}' has no member named '${reference.token.text}'`
				: `Type '${hostType}' has no member named '${reference.token.text}'. Did you mean '${suggestion}'?`,
			fix: suggestion === undefined ? undefined : {
				title: `Replace with ${suggestion}`,
				edits: [{
					kind: 'replace',
					line: reference.token.line,
					content: lineText.slice(0, reference.token.range.start.character) + suggestion + lineText.slice(reference.token.range.end.character)
				}]
			}
		});
	}
}

function closestName(word: string, candidates: readonly string[]): string | undefined {
	let best: string | undefined;
	let bestDistance = Infinity;
	for (const candidate of candidates) {
		const d = editDistance(word, candidate);
		if (d < bestDistance) {
			bestDistance = d;
			best = candidate;
		}
	}
	return best !== undefined && bestDistance <= 2 ? best : undefined;
}

function getExpressionRangeOnLine(lineText: string): { start: number; end: number } | undefined {
	const match = /^(\s*)(@\S+)/.exec(lineText);
	if (match === null) return undefined;
	const operator = match[2];
	const afterOperator = match[1].length + operator.length;

	switch (operator) {
		case '@if':
		case '@elseif':
		case '@return':
		case '@var':
			return { start: afterOperator, end: lineText.length };
		case '@define': {
			const eq = lineText.indexOf('=', afterOperator);
			return eq === -1 ? undefined : { start: eq + 1, end: lineText.length };
		}
		case '@for': {
			const inMatch = /\s+in\s+/.exec(lineText.slice(afterOperator));
			if (inMatch?.index === undefined) return undefined;
			return { start: afterOperator + inMatch.index + inMatch[0].length, end: lineText.length };
		}
		case '@chatscript': {
			const argsMatch = /^\s+\S+\s+\S+\s+/.exec(lineText.slice(afterOperator));
			if (argsMatch === null) return undefined;
			return { start: afterOperator + argsMatch[0].length, end: lineText.length };
		}
		default:
			return undefined;
	}
}

function validateNamespaceReferences(resolution: DocumentResolution, diagnostics: Diagnostic[]) {
	for (const reference of resolution.references) {
		if (reference.symbol.kind !== 'namespace') continue;
		if (resolution.hasNamespace(reference.symbol.name)) continue;
		raise(diagnostics, RULES.SEM005, reference.token.range, {
			message: `Unknown namespace: '${reference.symbol.name}'`
		});
	}
}

function validateNamespaceMembers(lines: readonly string[], resolution: DocumentResolution, diagnostics: Diagnostic[]) {
	for (const reference of resolution.references) {
		if (reference.symbol.kind !== 'unresolved') continue;
		const namespaceName = resolution.getNamespaceQualifier(reference.token.range.start);
		if (namespaceName === undefined) continue;
		const suggestion = closestName(reference.token.text, resolution.getNamespaceMemberNames(namespaceName));
		const lineText = lines[reference.token.line] ?? '';
		raise(diagnostics, RULES.SEM006, reference.token.range, {
			message: suggestion === undefined
				? `Namespace '${namespaceName}' has no member named '${reference.token.text}'`
				: `Namespace '${namespaceName}' has no member named '${reference.token.text}'. Did you mean '${suggestion}'?`,
			fix: suggestion === undefined ? undefined : {
				title: `Replace with ${suggestion}`,
				edits: [{
					kind: 'replace',
					line: reference.token.line,
					content: lineText.slice(0, reference.token.range.start.character) + suggestion + lineText.slice(reference.token.range.end.character)
				}]
			}
		});
	}
}

function validateConditionTypes(lines: readonly string[], resolution: DocumentResolution, diagnostics: Diagnostic[]) {
	for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
		const match = /^(\s*)@(if|elseif)\s+(.+)$/.exec(lines[lineNumber]);
		if (match === null) continue;
		const conditionStart = match[1].length + 1 + match[2].length + 1;
		const conditionText = lines[lineNumber].slice(conditionStart).trimEnd();
		const analysis = resolution.analyzeExpression(conditionText, lineNumber, conditionStart);
		if (analysis.diagnostics.length > 0) continue;
		if (analysis.type === undefined || analysis.type === 'Boolean') continue;
		raise(diagnostics, RULES.SEM007, {
			start: { line: lineNumber, character: conditionStart },
			end: { line: lineNumber, character: conditionStart + conditionText.length }
		}, { message: `Condition must be Boolean, got ${analysis.type}` });
	}
}

// Mirrors the server's strict equality (org.minr.server.scripts.expression.ParameterList#accepts
// and the @define/@var setValue paths). No implicit numeric widening: Int and Long are not
// interchangeable in assignments or function arguments. Operator dispatch is separate
// (it's overload-based via the OPERATOR_OVERLOADS table in resolver.ts).
function isAssignableTo(target: string, source: string): boolean {
	if (target === source) return true;
	if (source === 'Null' || source === 'Unknown' || target === 'Unknown') return true;
	return false;
}

function validateDefineInitializers(lines: readonly string[], resolution: DocumentResolution, diagnostics: Diagnostic[]) {
	for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
		const match = /^(\s*)@define\s+([\w:]+(?:\[\])?)\s+\w+\s*=\s*(.+)$/.exec(lines[lineNumber]);
		if (match === null) continue;
		const declaredType = resolution.normalizeType(match[2], lineNumber);
		const initializerText = match[3].trimEnd();
		const initializerStart = lines[lineNumber].length - match[3].length;
		const analysis = resolution.analyzeExpression(initializerText, lineNumber, initializerStart);
		if (analysis.diagnostics.length > 0 || analysis.type === undefined) continue;
		if (isAssignableTo(declaredType, analysis.type)) continue;
		raise(diagnostics, RULES.SEM010, {
			start: { line: lineNumber, character: initializerStart },
			end: { line: lineNumber, character: initializerStart + initializerText.length }
		}, { message: `Cannot assign ${analysis.type} to ${declaredType}` });
	}
}

function validateFinalReassignment(lines: readonly string[], resolution: DocumentResolution, diagnostics: Diagnostic[]) {
	for (let i = 0; i < lines.length; i++) {
		if (!lines[i].trim().startsWith('@var')) continue;
		for (const reference of resolution.references) {
			if (reference.token.line !== i) continue;
			if (reference.symbol.member?.isFinal !== true) continue;
			const lineText = lines[i];
			let pos = reference.token.range.end.character;
			while (pos < lineText.length && /\s/.test(lineText[pos])) pos++;
			if (pos >= lineText.length) continue;
			const ch = lineText[pos];
			const next = lineText[pos + 1];
			const isAssignment = (ch === '=' && next !== '=') || ('+-*/%'.includes(ch) && next === '=');
			if (!isAssignment) continue;
			raise(diagnostics, RULES.SEM021, reference.token.range, {
				message: `'${reference.symbol.name}' is final and cannot be reassigned`
			});
		}
	}
}

function validateVarAssignments(lines: readonly string[], resolution: DocumentResolution, diagnostics: Diagnostic[]) {
	for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
		const lineText = lines[lineNumber];
		const m = /^(\s*)@var\s+/.exec(lineText);
		if (m === null) continue;
		const afterOp = m[0].length;
		const tail = lineText.slice(afterOp);
		const opMatch = / (=|\+=|-=|\*=|\/=|%=) /.exec(tail);
		if (opMatch === null) continue;

		const opText = opMatch[1];
		const targetText = tail.slice(0, opMatch.index).trimEnd();
		const targetStart = afterOp;
		const targetAnalysis = resolution.analyzeExpression(targetText, lineNumber, targetStart);
		if (targetAnalysis.diagnostics.length > 0 || targetAnalysis.type === undefined) continue;

		const exprStart = afterOp + opMatch.index + opMatch[0].length;
		const exprText = lineText.slice(exprStart).trimEnd();
		if (exprText === '') continue;

		const valueText = opText === '=' ? exprText : `${targetText} ${opText.charAt(0)} ${exprText}`;
		const valueAnalysis = resolution.analyzeExpression(valueText, lineNumber, opText === '=' ? exprStart : targetStart);
		if (valueAnalysis.diagnostics.length > 0 || valueAnalysis.type === undefined) continue;

		if (isAssignableTo(targetAnalysis.type, valueAnalysis.type)) continue;
		raise(diagnostics, RULES.SEM011, {
			start: { line: lineNumber, character: exprStart },
			end: { line: lineNumber, character: exprStart + exprText.length }
		}, { message: `Cannot assign ${valueAnalysis.type} to ${targetAnalysis.type}` });
	}
}

function validateClassAsValue(lines: readonly string[], resolution: DocumentResolution, diagnostics: Diagnostic[]) {
	for (const reference of resolution.references) {
		if (reference.symbol.kind !== 'classType') continue;
		if (reference.token.flags?.declaration) continue;
		const lineText = lines[reference.token.line] ?? '';
		let i = reference.token.range.end.character;
		while (i < lineText.length && /\s/.test(lineText[i])) i++;
		// `Type[...]` is array-literal syntax, not a value use of the class.
		if (lineText[i] === '[') continue;
		raise(diagnostics, RULES.SEM018, reference.token.range, {
			message: `'${reference.token.text}' is a class name, not a value. Did you mean '${reference.token.text}(...)' to call the constructor?`
		});
	}
}

function validateRedeclarations(lines: readonly string[], initialScopeNames: readonly string[], diagnostics: Diagnostic[]) {
	const stack: Map<string, true>[] = [new Map()];
	const topScope = () => stack[stack.length - 1];
	for (const name of initialScopeNames) topScope().set(name, true);

	for (let i = 0; i < lines.length; i++) {
		const lineText = lines[i];
		const trimmed = lineText.trim();
		if (trimmed === '' || trimmed.startsWith('#')) continue;
		const op = trimmed.split(/\s+/)[0];

		if (op === '@if' || op === '@for') {
			stack.push(new Map());
		}

		if (op === '@for') {
			const m = /^@for\s+[\w:]+(?:\[\])?\s+(\w+)\s+in\b/.exec(trimmed);
			if (m !== null) {
				const name = m[1];
				if (topScope().has(name)) {
					const start = lineText.indexOf(name, lineText.indexOf('@for') + 4);
					raise(diagnostics, RULES.SEM017, {
						start: { line: i, character: start },
						end: { line: i, character: start + name.length }
					}, { message: `'${name}' is already declared in this scope` });
				} else {
					topScope().set(name, true);
				}
			}
		} else if (op === '@define') {
			const m = /^@define\s+[\w:]+(?:\[\])?\s+(\w+)/.exec(trimmed);
			if (m !== null) {
				const name = m[1];
				if (topScope().has(name)) {
					const start = lineText.indexOf(name, lineText.indexOf('@define') + 7);
					raise(diagnostics, RULES.SEM017, {
						start: { line: i, character: start },
						end: { line: i, character: start + name.length }
					}, { message: `'${name}' is already declared in this scope` });
				} else {
					topScope().set(name, true);
				}
			}
		}

		if (op === '@fi' || op === '@done') {
			if (stack.length > 1) stack.pop();
		}
		if (op === '@else' || op === '@elseif') {
			if (stack.length > 1) stack.pop();
			stack.push(new Map());
		}
	}
}

function validateInterpolations(resolution: DocumentResolution, diagnostics: Diagnostic[]) {
	for (const token of resolution.tokens) {
		if (token.kind !== 'interpolation') continue;
		if (!token.text.endsWith('}}')) {
			raise(diagnostics, RULES.SYN023, token.range);
			continue;
		}
		const inner = token.text.slice(2, -2);
		if (inner.trim() !== '') continue;
		raise(diagnostics, RULES.SEM012, token.range);
	}
}

function validateStringLiterals(resolution: DocumentResolution, diagnostics: Diagnostic[]) {
	for (const token of resolution.tokens) {
		if (token.kind !== 'stringLiteral') continue;
		if (!token.text.startsWith('"')) continue;
		if (token.text.length >= 2 && token.text.endsWith('"')) continue;
		raise(diagnostics, RULES.SYN022, token.range);
	}
}

function validatePromptTarget(lines: readonly string[], resolution: DocumentResolution, diagnostics: Diagnostic[]) {
	for (let i = 0; i < lines.length; i++) {
		const m = /^(\s*)@prompt\s+\S+\s+([\w:]+)/.exec(lines[i]);
		if (m === null) continue;
		const name = m[2];
		const start = lines[i].indexOf(name, m[1].length + '@prompt'.length);
		const range = { start: { line: i, character: start }, end: { line: i, character: start + name.length } };
		const analysis = resolution.analyzeExpression(name, i, start);
		if (analysis.diagnostics.length > 0) continue;
		if (analysis.type === undefined) {
			raise(diagnostics, RULES.SEM019, range, { message: `'${name}' is not a defined String variable` });
			continue;
		}
		if (analysis.type !== 'String') {
			raise(diagnostics, RULES.SEM019, range, { message: `'${name}' has type ${analysis.type}; @prompt requires a String variable` });
		}
	}
}

function validateConstantConditions(lines: readonly string[], diagnostics: Diagnostic[]) {
	for (let i = 0; i < lines.length; i++) {
		const m = /^(\s*)@(if|elseif)\s+(true|false)\s*$/.exec(lines[i]);
		if (m === null) continue;
		const start = lines[i].indexOf(m[3], m[1].length + 1 + m[2].length);
		raise(diagnostics, RULES.STY003, {
			start: { line: i, character: start },
			end: { line: i, character: start + m[3].length }
		}, { message: `Condition is constant '${m[3]}'` });
	}
}

function validateRedundantUsing(lines: readonly string[], diagnostics: Diagnostic[]) {
	const seen = new Set<string>();
	for (let i = 0; i < lines.length; i++) {
		const m = /^(\s*)@using\s+(\w+)\s*$/.exec(lines[i]);
		if (m === null) continue;
		const name = m[2];
		if (seen.has(name)) {
			const start = lines[i].indexOf(name, m[1].length + '@using'.length);
			raise(diagnostics, RULES.STY004, {
				start: { line: i, character: start },
				end: { line: i, character: start + name.length }
			}, { message: `Namespace '${name}' has already been imported earlier` });
		}
		seen.add(name);
	}
}

function validateEmptyBlocks(lines: readonly string[], diagnostics: Diagnostic[]) {
	const stack: { type: 'if' | 'for' | 'else'; line: number }[] = [];
	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		if (trimmed === '' || trimmed.startsWith('#')) continue;
		const op = trimmed.split(/\s+/)[0];
		if (op === '@if') stack.push({ type: 'if', line: i });
		else if (op === '@for') stack.push({ type: 'for', line: i });
		else if (op === '@else' || op === '@elseif') {
			const top = stack[stack.length - 1];
			if (top !== undefined && i === top.line + 1) {
				raise(diagnostics, RULES.STY005, {
					start: { line: top.line, character: 0 },
					end: { line: top.line, character: lines[top.line].length }
				}, { message: 'Empty @if branch' });
			}
			if (top !== undefined) top.line = i;
		} else if (op === '@fi' || op === '@done') {
			const top = stack.pop();
			if (top !== undefined && i === top.line + 1) {
				raise(diagnostics, RULES.STY005, {
					start: { line: top.line, character: 0 },
					end: { line: top.line, character: lines[top.line].length }
				}, { message: `Empty ${top.type === 'if' ? '@if/@else' : '@for'} branch` });
			}
		}
	}
}

function validateShadowing(lines: readonly string[], initialScopeNames: readonly string[], diagnostics: Diagnostic[]) {
	const stack: Map<string, true>[] = [new Map()];
	const top = () => stack[stack.length - 1];
	for (const name of initialScopeNames) top().set(name, true);

	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		if (trimmed === '' || trimmed.startsWith('#')) continue;
		const op = trimmed.split(/\s+/)[0];

		if (op === '@if' || op === '@for') stack.push(new Map());

		const flag = (name: string, lineText: string, opName: string) => {
			for (let j = 0; j < stack.length - 1; j++) {
				if (!stack[j].has(name)) continue;
				const start = lineText.indexOf(name, lineText.indexOf(opName) + opName.length);
				raise(diagnostics, RULES.STY006, {
					start: { line: i, character: start },
					end: { line: i, character: start + name.length }
				}, { message: `'${name}' shadows a variable in an outer scope` });
				return;
			}
			top().set(name, true);
		};

		if (op === '@for') {
			const m = /^@for\s+[\w:]+(?:\[\])?\s+(\w+)\s+in\b/.exec(trimmed);
			if (m !== null) flag(m[1], lines[i], '@for');
		} else if (op === '@define') {
			const m = /^@define\s+[\w:]+(?:\[\])?\s+(\w+)/.exec(trimmed);
			if (m !== null) flag(m[1], lines[i], '@define');
		}

		if (op === '@fi' || op === '@done') {
			if (stack.length > 1) stack.pop();
		}
		if (op === '@else' || op === '@elseif') {
			if (stack.length > 1) stack.pop();
			stack.push(new Map());
		}
	}
}

const PARAM_MODIFIERS = new Set(['final', 'relative', 'private']);

function extractParamType(label: string): string {
	const tokens = label.trim().split(/\s+/);
	for (const token of tokens) {
		if (!PARAM_MODIFIERS.has(token)) return token;
	}
	return 'Unknown';
}

function normalizeSignatureParams(parameters: readonly { label: string | [number, number] }[] | undefined): string[] {
	if (parameters === undefined) return [];
	const labels = parameters.map(p => typeof p.label === 'string' ? p.label : '');
	if (labels.length === 1 && labels[0].trim() === '') return [];
	return labels.map(extractParamType);
}

function findCallSite(lineText: string, tokenEnd: number): { argsStart: number; argsEnd: number; callEnd: number } | undefined {
	let i = tokenEnd;
	while (i < lineText.length && /\s/.test(lineText[i])) i++;
	if (i >= lineText.length || lineText[i] !== '(') return undefined;
	const argsStart = i + 1;
	let depth = 1;
	let inString = false;
	let j = argsStart;
	while (j < lineText.length && depth > 0) {
		const c = lineText[j];
		if (c === '"') inString = !inString;
		else if (!inString) {
			if (c === '(' || c === '[') depth++;
			else if (c === ')' || c === ']') depth--;
		}
		if (depth > 0) j++;
	}
	if (depth !== 0) return undefined;
	return { argsStart, argsEnd: j, callEnd: j + 1 };
}

function splitTopLevelArgs(text: string, baseOffset: number): { text: string; startChar: number }[] {
	if (text.trim() === '') return [];
	const result: { text: string; startChar: number }[] = [];
	let depth = 0;
	let inString = false;
	let lastStart = 0;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === '"') inString = !inString;
		else if (!inString) {
			if (c === '(' || c === '[') depth++;
			else if (c === ')' || c === ']') depth--;
			else if (c === ',' && depth === 0) {
				result.push({ text: text.slice(lastStart, i), startChar: baseOffset + lastStart });
				lastStart = i + 1;
			}
		}
	}
	result.push({ text: text.slice(lastStart), startChar: baseOffset + lastStart });
	return result;
}

const NON_CALLABLE_KINDS = new Set(['localVariable', 'builtinVariable', 'namespaceVariable', 'instanceField']);

function validateCallableUsage(lines: readonly string[], resolution: DocumentResolution, diagnostics: Diagnostic[]) {
	for (const reference of resolution.references) {
		if (!NON_CALLABLE_KINDS.has(reference.symbol.kind)) continue;
		const lineText = lines[reference.token.line];
		if (lineText === undefined) continue;
		let i = reference.token.range.end.character;
		while (i < lineText.length && /\s/.test(lineText[i])) i++;
		if (i >= lineText.length || lineText[i] !== '(') continue;
		const kindLabel = reference.symbol.kind === 'instanceField' ? 'field' : 'variable';
		raise(diagnostics, RULES.SEM016, reference.token.range, {
			message: `'${reference.token.text}' is a ${kindLabel} of type ${reference.symbol.type}, not a callable`
		});
	}
}

function validateCallArguments(lines: readonly string[], resolution: DocumentResolution, diagnostics: Diagnostic[]) {
	for (const reference of resolution.references) {
		if (!reference.isCallable) continue;
		const lineText = lines[reference.token.line];
		if (lineText === undefined) continue;
		const callSite = findCallSite(lineText, reference.token.range.end.character);
		if (callSite === undefined) continue;

		const signatures = resolution.getCallableSignatures(reference);
		if (signatures.length === 0) continue;

		const argSplits = splitTopLevelArgs(lineText.slice(callSite.argsStart, callSite.argsEnd), callSite.argsStart);
		const argTypes: (string | undefined)[] = argSplits.map(arg => {
			const trimmed = arg.text.trim();
			if (trimmed === '') return undefined;
			const analysis = resolution.analyzeExpression(trimmed, reference.token.line, arg.startChar + (arg.text.length - arg.text.trimStart().length));
			if (analysis.diagnostics.length > 0) return undefined;
			return analysis.type;
		});
		if (argTypes.some(t => t === undefined)) continue;
		const concreteTypes = argTypes as string[];

		const candidateSignatures: string[] = [];
		let matched = false;
		for (const signature of signatures) {
			const params = normalizeSignatureParams(signature.parameters);
			candidateSignatures.push(`(${params.join(', ')})`);
			if (params.length !== concreteTypes.length) continue;
			let ok = true;
			for (let i = 0; i < params.length; i++) {
				const target = resolution.normalizeType(params[i], reference.token.line);
				if (!isAssignableTo(target, concreteTypes[i])) { ok = false; break; }
			}
			if (ok) { matched = true; break; }
		}
		if (matched) continue;

		const callRange = {
			start: { line: reference.token.line, character: callSite.argsStart - 1 },
			end: { line: reference.token.line, character: callSite.callEnd }
		};
		const got = `(${concreteTypes.join(', ')})`;
		const expected = candidateSignatures.length === 1 ? candidateSignatures[0] : `one of ${candidateSignatures.join(', ')}`;
		raise(diagnostics, RULES.SEM013, callRange, {
			message: `Cannot call '${reference.symbol.name}' with arguments ${got}. Expected ${expected}.`
		});
	}
}

function validateForIterable(lines: readonly string[], resolution: DocumentResolution, diagnostics: Diagnostic[]) {
	for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
		const match = /^(\s*)@for\s+([\w:]+(?:\[\])?)\s+\w+\s+in\s+(.+)$/.exec(lines[lineNumber]);
		if (match === null) continue;
		const declaredType = resolution.normalizeType(match[2], lineNumber);
		const iterableText = match[3].trimEnd();
		const iterableStart = lines[lineNumber].length - match[3].length;
		const analysis = resolution.analyzeExpression(iterableText, lineNumber, iterableStart);
		if (analysis.diagnostics.length > 0 || analysis.type === undefined) continue;
		const iterableType = analysis.type;
		const range = {
			start: { line: lineNumber, character: iterableStart },
			end: { line: lineNumber, character: iterableStart + iterableText.length }
		};
		if (!iterableType.endsWith('[]')) {
			raise(diagnostics, RULES.SEM008, range, {
				message: `@for iterable must be an array type, got ${iterableType}`
			});
			continue;
		}
		const elementType = iterableType.slice(0, -2);
		if (elementType !== declaredType) {
			raise(diagnostics, RULES.SEM009, range, {
				message: `@for variable is ${declaredType} but iterable element type is ${elementType}`
			});
		}
	}
}

function validateUndefinedIdentifiers(lines: readonly string[], resolution: DocumentResolution, diagnostics: Diagnostic[]) {
	for (const reference of resolution.references) {
		if (reference.symbol.kind !== 'unresolved') continue;
		if (reference.token.kind !== 'identifier') continue;
		if (reference.isDeclaration) continue;
		const startChar = reference.token.range.start.character;
		const lineText = lines[reference.token.line] ?? '';
		const prev = startChar > 0 ? lineText[startChar - 1] : '';
		if (prev === '.' || prev === ':') continue;

		if (!reference.token.flags?.interpolation) {
			const range = getExpressionRangeOnLine(lineText);
			if (range === undefined) continue;
			if (startChar < range.start || reference.token.range.end.character > range.end) continue;
		}

		raise(diagnostics, RULES.SEM004, reference.token.range, {
			message: `'${reference.token.text}' is not defined in the current scope`
		});
	}
}

async function validateAndReportDiagnostics(textDocument: TextDocument): Promise<void> {
	// Suppress diagnostics until both the default namespaces (sent by the
	// client) and the workspace `.nms` scan have loaded at least once;
	// otherwise nearly every type/namespace reference flags as unknown.
	// revalidateAllOpenDocuments() re-runs us once each loader flips its flag.
	if (!defaultsLoaded || !workspaceLoaded) {
		connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [] });
		return;
	}

	const text = textDocument.getText();
	const lines = text.split('\n');
	const suppressions = parseSuppressions(lines);

	if (suppressions.file === 'any') {
		connection.sendDiagnostics({
			uri: textDocument.uri,
			diagnostics: []
		});
		return;
	}

	const parsingContext = new ScriptParsingContext();
	const diagnostics: Diagnostic[] = [];
	const resolution = await getDocumentResolution(textDocument.uri).catch(() => undefined);

	for (let i = 0; i < lines.length; i++) {
		processLine(lines[i], i, parsingContext, diagnostics);
	}

	if (resolution !== undefined) {
		validateSemanticExpressions(lines, resolution, diagnostics);
		validateDeclaredTypes(resolution, diagnostics);
		validateMemberAccess(lines, resolution, diagnostics);
		validateUndefinedIdentifiers(lines, resolution, diagnostics);
		validateNamespaceReferences(resolution, diagnostics);
		validateNamespaceMembers(lines, resolution, diagnostics);
		validateConditionTypes(lines, resolution, diagnostics);
		validateForIterable(lines, resolution, diagnostics);
		validateDefineInitializers(lines, resolution, diagnostics);
		validateVarAssignments(lines, resolution, diagnostics);
		validateInterpolations(resolution, diagnostics);
		validateStringLiterals(resolution, diagnostics);
		validateCallArguments(lines, resolution, diagnostics);
		validateCallableUsage(lines, resolution, diagnostics);
		validateClassAsValue(lines, resolution, diagnostics);
		validatePromptTarget(lines, resolution, diagnostics);
		validateFinalReassignment(lines, resolution, diagnostics);
	}

	const initialScopeNames = resolution?.getInitialScopeNames() ?? [];
	validateRedeclarations(lines, initialScopeNames, diagnostics);
	validateConstantConditions(lines, diagnostics);
	validateRedundantUsing(lines, diagnostics);
	validateEmptyBlocks(lines, diagnostics);
	validateShadowing(lines, initialScopeNames, diagnostics);

	if (parsingContext.blockStack.length > 0) {
		for (const block of parsingContext.blockStack) {
			if (block.type === 'if' || block.type === 'for') {
				const opStart = lines[block.line].indexOf(`@${block.type}`);
				const rule = block.type === 'if' ? RULES.SYN001 : RULES.SYN002;
				raise(diagnostics, rule, {
					start: { line: block.line, character: opStart },
					end: { line: block.line, character: opStart + block.type.length + 1 }
				});
			}
		}
	}

	const fileCodes = suppressions.file;
	const filtered: Diagnostic[] = [];
	for (const d of diagnostics) {
		const code = diagnosticCode(d);
		if (code && fileCodes.has(code)) continue;
		const lineSup = suppressions.perLine.get(d.range.start.line);
		if (lineSup === 'any') continue;
		if (lineSup && code && lineSup.has(code)) continue;

		const rule = code ? RULES[code] : undefined;
		const override = rule ? categoryOverrides.get(rule.category) : undefined;
		if (override === 'off') continue;
		if (override !== undefined) {
			d.severity = SEVERITY_FROM_OVERRIDE[override];
		}
		filtered.push(d);
	}

	connection.sendDiagnostics({
		uri: textDocument.uri,
		diagnostics: filtered
	});
}

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Register the text document validation function
documents.onDidSave(change => {
	void validateAndReportDiagnostics(change.document);
});

// Register the text document validation function
documents.onDidOpen(change => {
	void refreshDocumentResolution(change.document.uri);
	void validateAndReportDiagnostics(change.document);
});

documents.onDidChangeContent(e => {
	void refreshDocumentResolution(e.document.uri);
	void validateAndReportDiagnostics(e.document);
});

documents.onDidClose(e => {
	documentResolutions.delete(e.document.uri);
});

connection.onDidChangeWatchedFiles(_ => {
	void refreshNamespaceFiles();
});

// Listen on the connection
connection.listen();
