/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
	createConnection,
	TextDocuments,
	Diagnostic,
	DiagnosticSeverity,
	ProposedFeatures,
	InitializeParams,
	// DidChangeConfigurationNotification,
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
	Hover,
	HoverParams
} from 'vscode-languageserver-protocol';
import { readFile } from 'fs';
import { files } from 'node-dir';

import {
	VariableInfo,
	NamespaceInfo,
	ClassInfo,
	UsingDeclaration,
	SourceFileData,
	parseNamespaceFile,
	newLineRegExp,
	namespaceSignatureRegExp,
	classSignatureRegExp,
	functionSignatureRegExp,
	constructorSignatureRegExp,
	variableSignatureRegExp,
	parseDocument
} from './parser';
import { keywords, keywordsWithoutAtSymbol, keywordCommands } from './keywords';

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
			hoverProvider: true
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
	refreshNamespaceFiles();
});

const sourceFileData: Map<string, Thenable<SourceFileData>> = new Map();
const defaultNamespaces: Map<string, NamespaceInfo> = new Map();
const namespaces: Map<string, NamespaceInfo> = new Map();
const classes: Map<string, ClassInfo> = new Map();

function refreshNamespaceFiles() {
	// search for .nms files in all subfolders
	files('.', (err, files) => {
		if (err)
			return console.log('Unable to scan directory: ' + err);
		namespaces.clear();
		defaultNamespaces.forEach((value: NamespaceInfo, key: string) => {
			namespaces.set(key, value);
		});
		for (const filename of files) {
			const filenamesSplit = filename.split('.');
			if (filenamesSplit[filenamesSplit.length - 1] === 'nms') {
				readFile(filename, (err, data) => {
					if (err) return console.log('Unable to read file: ' + err);
					parseNamespaceFile(data.toString(), namespaces, classes);
				});
			}
		}
	});
}

function getDocumentData(documentUri: string): Thenable<SourceFileData> {
	let result = sourceFileData.get(documentUri);
	if (!result)
		result = refreshDocument(documentUri);
	return result;
}

function refreshDocument(documentUri: string): Promise<SourceFileData> {
	const result = new Promise<SourceFileData>((resolve) => {
		const document = documents.get(documentUri);
		if (document === undefined) {
			console.log('Couldn\'t read file ' + documentUri);
			resolve({
				variables: new Map(),
				usingDeclarations: []
			});
		}
		else
			resolve(parseDocument(document.getText()));
	});
	sourceFileData.set(documentUri, result);
	return result;
}

function skipStringBackward(line: string, pos: number): number | undefined {
	const stack: string[] = [];
	for (; pos >= 0; pos--) {
		if (line[pos] === '"') {
			if (stack.length === 0 || stack[stack.length - 1] !== '"') {
				stack.push('"');
			}
			else if (pos === 0 || line[pos - 1] !== '\\') {
				stack.pop();
				if (stack.length === 0)
					return pos;
			}
		}
		else if (line[pos] === '}' && pos >= 1 && line[pos - 1] === '}' &&
			(pos === 1 || line[pos - 2] !== '\\')) {
			if (stack.length !== 0 && stack[stack.length - 1] === '"') {
				stack.push('}');
			}
			else {
				return undefined;
			}
		}
		else if (line[pos] === '{' && pos >= 1 && line[pos - 1] === '{' &&
			(pos === 1 || line[pos - 2] !== '\\')) {
			if (stack.length !== 0 && stack[stack.length - 1] === '}') {
				stack.pop();
			}
			else {
				return undefined;
			}
		}
	}
	return undefined;
}

function skipStringForward(line: string, pos: number): number | undefined {
	const stack: string[] = [];
	for (; pos < line.length; pos++) {
		if (line[pos] === '"') {
			if (stack.length === 0 || stack[stack.length - 1] !== '"') {
				stack.push('"');
			}
			else if (pos === 0 || line[pos - 1] !== '\\') {
				stack.pop();
				if (stack.length === 0)
					return pos;
			}
		}
		else if (line[pos] === '{' && pos + 1 < line.length && line[pos + 1] === '{' &&
			(pos === 0 || line[pos - 1] !== '\\')) {
			if (stack.length !== 0 && stack[stack.length - 1] === '"') {
				stack.push('{');
			}
			else {
				return undefined;
			}
		}
		else if (line[pos] === '}' && pos + 1 < line.length && line[pos + 1] === '}' &&
			(pos === 0 || line[pos - 1] !== '\\')) {
			if (stack.length !== 0 && stack[stack.length - 1] === '{') {
				stack.pop();
			}
			else {
				return undefined;
			}
		}
	}
	return undefined;
}

function skipParenthesizedExpression(line: string, pos: number, closingParentheses: string): number | undefined {
	const openingParentheses = closingParentheses === ')' ? '(' : '[';
	if (line[pos] !== closingParentheses)
		return pos;

	let openParenthesesCount = 0;
	for (; pos >= 0; pos--) {
		const c = line[pos];
		if (c === '"') {
			const newPos = skipStringBackward(line, pos);
			if (newPos === undefined)
				return undefined;
			pos = newPos;
		}
		else if (c === closingParentheses)
			openParenthesesCount++;
		else if (c === openingParentheses) {
			openParenthesesCount--;
			if (openParenthesesCount === 0)
				return pos;
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
			}
			else if (c === '(' || c === '[')
				parenthesesStack.push(c);
			else if (c === ')') {
				if (parenthesesStack.length === 0 || parenthesesStack[parenthesesStack.length - 1] !== '(')
					return undefined;
				parenthesesStack.pop();
			}
			else if (c === ']') {
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

function parseCallChain(line: string): string[] {
	const result: string[] = [];

	// skip what user typed at the very end after last dot
	let i = line.length - 1;
	for (; i >= 0; i--) {
		if (!/[a-zA-Z0-9_.]/.test(line[i]))
			return [];
		if (line[i] === '.')
			break;
	}
	if (i === -1)
		return [];

	let scopeOperatorUsed = false;
	while (i >= 0) {
		if (line[i] === '.') {
			if (i === 0)
				return [];
			// skip array element access
			let hasArraySubscript = false;
			let newI = skipParenthesizedExpression(line, i - 1, ']');
			if (newI === undefined)
				return [];
			if (newI < i - 1) {
				hasArraySubscript = true;
				i = newI;
			}
			// skip method call
			let isFunction = false;
			newI = skipParenthesizedExpression(line, i - 1, ')');
			if (newI === undefined)
				return [];
			if (newI < i - 1) {
				isFunction = true;
				i = newI;
			}
			if (i <= 0)
				return [];
			let k = i - 1;
			for (; k >= 0; k--) {
				if (/[.:\s([{+\-*/%^!=<>&|,]/.test(line[k]))
					break;
				if (!/[a-zA-Z0-9_]/.test(line[k]))
					return [];
			}
			if (k === -1)
				return [];
			if (hasArraySubscript)
				result.push('[]');
			result.push(line.substring(k + 1, i) + (isFunction ? '()' : ''));
			i = k;
		}
		else if (line[i] === ':') {
			if (scopeOperatorUsed || i < 2 || line[i - 1] !== ':')
				return [];
			scopeOperatorUsed = true;
			let k = i - 2;
			for (; k >= 0; k--) {
				if (/[.:\s([{+\-*/%^!=<>&|,]/.test(line[k]))
					break;
				if (!/[a-zA-Z0-9_]/.test(line[k]))
					return [];
			}
			if (k === -1)
				return [];
			result.push(line.substring(k + 1, i + 1));
			i = k;
		}
		else if (/[.\s([{+\-*/%^!=<>&|,]/.test(line[i]))
			return result.reverse();
		else
			return [];
	}
	return [];
}

interface NameAndType {
	name: string,
	type: string
}

function getLastNameAndTypeFromCallChain(callChain: string[], currentDocumentData: SourceFileData,
	activeNamespaceName: string | undefined, lineNumber: number): NameAndType | undefined {
	if (callChain.length === 0)
		return undefined;

	let currentClass = '';
	let currentName = '';
	let startingI = 1;
	if (callChain[0].endsWith(':')) {
		startingI = 2;
		if (callChain.length === 1)
			return undefined;
		currentName = callChain[0].concat(callChain[1]);
		if (/[A-Z]/.test(callChain[1][0])) {
			if (!callChain[1].endsWith('()'))
				return undefined;
			currentClass = currentName.substring(0, currentName.length - 2);
		}
		else {
			const currentNamespaceInfo = namespaces.get(callChain[0].substring(0, callChain[0].length - 2));
			if (currentNamespaceInfo === undefined)
				return undefined;
			const currentNamespaceMember = currentNamespaceInfo.members.get(callChain[1]);
			if (currentNamespaceMember === undefined)
				return undefined;
			currentClass = currentNamespaceMember.returnType;
		}
	}
	else {
		currentName = callChain[0];
		if (/[A-Z]/.test(callChain[0][0])) {
			if (!callChain[0].endsWith('()'))
				return undefined;
			currentClass = callChain[0].substring(0, callChain[0].length - 2);
		}
		else {
			const currentVariables = currentDocumentData.variables.get(callChain[0]);
			let currentVariable: VariableInfo | undefined = undefined;
			if (currentVariables !== undefined)
				for (const variable of currentVariables)
					if (variable.lineDeclared < lineNumber && (variable.lineUndeclared === undefined
						|| variable.lineUndeclared > lineNumber))
						currentVariable = variable;
			if (currentVariable !== undefined) {
				currentClass = currentVariable.type;
			}
			else {
				if (activeNamespaceName === undefined)
					return undefined;
				const activeNamespace = namespaces.get(activeNamespaceName);
				if (activeNamespace === undefined)
					return undefined;
				const currentMember = activeNamespace.members.get(callChain[0]);
				if (currentMember === undefined)
					return undefined;
				currentName = activeNamespaceName + '::' + callChain[0];
				currentClass = currentMember.returnType;
			}

		}
	}

	for (let i = startingI; i < callChain.length; i++) {
		if (callChain[i] === '[]') {
			if (!currentClass.endsWith('[]'))
				return undefined;
			currentName = currentClass;
			currentClass = currentClass.substring(0, currentClass.length - 2);
			continue;
		}
		let currentClassInfo = classes.get(currentClass);
		if (currentClassInfo === undefined) {
			if (i !== 1 || activeNamespaceName === undefined)
				return undefined;
			currentClassInfo = classes.get(activeNamespaceName + '::' + currentClass);
			if (currentClassInfo === undefined)
				return undefined;
			currentClass = activeNamespaceName + '::' + currentClass;
		}
		const nextMember = currentClassInfo.members.get(callChain[i]);
		if (nextMember === undefined)
			return undefined;
		currentName = currentClass + '.' + nextMember.name;
		currentClass = nextMember.returnType;
	}

	let currentClassWithoutArray = currentClass;
	if (currentClass.endsWith('[]'))
		currentClassWithoutArray = currentClass.substring(0, currentClass.length - 2);
	if (!classes.has(currentClassWithoutArray)) {
		if (activeNamespaceName !== undefined && classes.has(activeNamespaceName + '::' + currentClassWithoutArray))
			currentClass = activeNamespaceName + '::' + currentClass;
		else
			return undefined;
	}

	return {
		name: currentName,
		type: currentClass
	};
}

interface FunctionCallInfo {
	name: string,
	paramNumber: number
}

function parseFunctionCall(line: string, currentDocumentData: SourceFileData,
	activeNamespace: string | undefined, lineNumber: number): FunctionCallInfo | undefined {
	let i = line.length - 1;
	let paramNumber = 0;
	for (; i >= 0; i--) {
		if (line[i] === '"') {
			const j = skipStringBackward(line, i);
			if (j === undefined)
				return undefined;
			i = j;
		}
		else if (line[i] === ')' || line[i] === ']') {
			const j = skipParenthesizedExpression(line, i, line[i]);
			if (j === undefined)
				return undefined;
			i = j;
		}
		else if (line[i] === '[')
			return undefined;
		else if (line[i] === ',')
			paramNumber++;
		else if (line[i] === '(') {
			if (i === 0)
				return undefined;
			if (/[\s([+\-*/%^!=<>&|,]/.test(line[i - 1])) {
				paramNumber = 0;
				continue;
			}
			if (!/[a-zA-Z0-9_]/.test(line[i - 1]))
				return undefined;
			const callChain = parseCallChain(line.substring(0, i) + '().');
			const lastNameAndType = getLastNameAndTypeFromCallChain(callChain, currentDocumentData, activeNamespace, lineNumber);
			if (lastNameAndType === undefined)
				return undefined;
			return {
				name: lastNameAndType.name,
				paramNumber: paramNumber
			};
		}
	}
	return undefined;
}

function findActiveNamespace(usingDeclarations: UsingDeclaration[], line: number): string | undefined {
	let closestUsingLine = -1;
	let result: string | undefined = undefined;
	for (const usingDeclaration of usingDeclarations) {
		if (usingDeclaration.lineDeclared > closestUsingLine && usingDeclaration.lineDeclared < line) {
			closestUsingLine = usingDeclaration.lineDeclared;
			result = usingDeclaration.namespace;
		}
	}
	return result;
}

connection.onSignatureHelp(
	async (textDocumentPosition: SignatureHelpParams): Promise<SignatureHelp> => {
		const documentData = await getDocumentData(textDocumentPosition.textDocument.uri);
		const activeNamespace = findActiveNamespace(documentData.usingDeclarations, textDocumentPosition.position.line);

		const result: SignatureHelp = {
			signatures: [],
			activeSignature: 0,
			activeParameter: 0
		};

		const document = documents.get(textDocumentPosition.textDocument.uri);
		if (document === undefined)
			return result;
		const line = document.getText({
			start: {
				line: textDocumentPosition.position.line,
				character: 0
			}, end: {
				line: textDocumentPosition.position.line,
				character: textDocumentPosition.position.character
			}
		});

		const info = parseFunctionCall(line, documentData, activeNamespace, textDocumentPosition.position.line);
		if (info === undefined)
			return result;
		let name = info.name;

		for (let i = 0; i < 2; i++) {
			if (i === 1 && activeNamespace !== undefined)
				name = activeNamespace + '::' + name;
			const scopeOperatorPosition = name.indexOf('::');
			const dotPosition = name.indexOf('.');
			if (scopeOperatorPosition !== -1 && scopeOperatorPosition < name.length - 2
				&& /[a-z]/.test(name[scopeOperatorPosition + 2])) {
				// namespace function call
				const namespaceName = name.substring(0, scopeOperatorPosition);
				const functionName = name.substring(scopeOperatorPosition + 2);
				const currentNamespace = namespaces.get(namespaceName);
				if (currentNamespace === undefined)
					break;
				const signatures = currentNamespace.memberSignatures.get(functionName);
				if (signatures !== undefined)
					result.signatures = signatures;
				break;
			}
			else if (dotPosition !== -1) {
				// class method call
				const className = name.substring(0, dotPosition);
				const methodName = name.substring(dotPosition + 1);
				const currentClass = classes.get(className);
				if (currentClass === undefined)
					break;
				const signatures = currentClass.memberSignatures.get(methodName);
				if (signatures !== undefined)
					result.signatures = signatures;
				break;
			}
			else {
				// class constructor call
				const className = name.substring(0, name.length - 2);
				const currentClass = classes.get(className);
				if (currentClass === undefined)
					continue;

				let constructorName = name;
				if (scopeOperatorPosition !== -1 && scopeOperatorPosition < name.length - 2)
					constructorName = constructorName.substring(scopeOperatorPosition + 2);
				const signatures = currentClass.memberSignatures.get(constructorName);
				if (signatures !== undefined)
					result.signatures = signatures;
				break;
			}
		}

		for (const signature of result.signatures)
			signature.activeParameter = info.paramNumber;
		return result;
	}
);

connection.onHover(
	async (textDocumentPosition: HoverParams): Promise<Hover | undefined> => {
		const documentData = await getDocumentData(textDocumentPosition.textDocument.uri);
		const activeNamespace = findActiveNamespace(documentData.usingDeclarations, textDocumentPosition.position.line);

		const document = documents.get(textDocumentPosition.textDocument.uri);
		if (document === undefined)
			return undefined;
		let line = document.getText({
			start: {
				line: textDocumentPosition.position.line,
				character: 0
			}, end: {
				line: textDocumentPosition.position.line + 1,
				character: 0
			}
		});
		line = line.trimEnd();
		let i = textDocumentPosition.position.character;
		if (!/[a-zA-Z0-9_]/.test(line[i]))
			return undefined;
		for (; i < line.length; i++) {
			if (!/[a-zA-Z0-9_]/.test(line[i]))
				break;
		}
		let parseString = line.substring(0, i);
		if (i < line.length && line[i] === ':')
			return undefined;
		else if (i < line.length && line[i] === '(')
			parseString += '().a';
		else
			parseString += '.a';

		const callChain = parseCallChain(parseString);
		const nameAndType = getLastNameAndTypeFromCallChain(callChain, documentData, activeNamespace, textDocumentPosition.position.line);
		if (nameAndType === undefined)
			return undefined;

		let documentation: string | undefined = undefined;

		const dotPosition = nameAndType.name.indexOf('.');
		const scopeOperatorPosition = nameAndType.name.indexOf('::');
		if (dotPosition !== -1) {
			const currentClass = classes.get(nameAndType.name.substring(0, dotPosition));
			if (currentClass === undefined)
				return undefined;
			const currentMember = currentClass.members.get(nameAndType.name.substring(dotPosition + 1));
			if (currentMember !== undefined)
				documentation = currentMember.documentation;
		}
		else if (scopeOperatorPosition !== -1) {
			const currentNamespace = namespaces.get(nameAndType.name.substring(0, scopeOperatorPosition));
			if (currentNamespace === undefined)
				return undefined;
			const currentMember = currentNamespace.members.get(nameAndType.name.substring(scopeOperatorPosition + 2));
			if (currentMember !== undefined)
				documentation = currentMember.documentation;
		}

		return {
			contents: {
				kind: MarkupKind.Markdown,
				value: [
					'```msc',
					(nameAndType.type !== 'Void' ? nameAndType.type + ' ' : '') + nameAndType.name,
					'```'
				].join('\n') + (documentation === undefined ? '' : '\n' + documentation)
			}
		};
	}
);

connection.onCompletion(
	async (textDocumentPosition: TextDocumentPositionParams): Promise<CompletionItem[]> => {
		const documentData = await getDocumentData(textDocumentPosition.textDocument.uri);
		const activeNamespace = findActiveNamespace(documentData.usingDeclarations, textDocumentPosition.position.line);

		const document = documents.get(textDocumentPosition.textDocument.uri);
		if (document === undefined)
			return [];
		const line = document.getText({
			start: {
				line: textDocumentPosition.position.line,
				character: 0
			}, end: {
				line: textDocumentPosition.position.line,
				character: textDocumentPosition.position.character
			}
		});
		const commandPrefixes = ['@bypass \\/', '@command \\/', '@console \\/'];
		const commandSuggestionRegExp = new RegExp(`^\\s*(${commandPrefixes.join('|')})[a-z]*$`, 'i');
		const commandSuggestionRegExpRes = commandSuggestionRegExp.exec(line);
		if (commandSuggestionRegExpRes !== null) {
			return keywordCommands;
		}
		const keywordSuggestionRegExp = /^\s*(@)?[a-z]+$/;
		const keywordSuggestionRegExpRes = keywordSuggestionRegExp.exec(line);
		if (keywordSuggestionRegExpRes !== null) {
			if (keywordSuggestionRegExpRes[1] === '@') {
				return keywordsWithoutAtSymbol;
			} else {
				return keywords;
			}
		}
		const namespaceSuggestionRegExp = /(?:^|[\s([{+\-*/!=<>&|,])([a-zA-Z][a-zA-Z0-9_]*)::[a-zA-Z0-9_]*$/;
		const namespaceSuggestionRegExpRes = namespaceSuggestionRegExp.exec(line);
		if (namespaceSuggestionRegExpRes !== null) {
			const namespaceData = namespaces.get(namespaceSuggestionRegExpRes[1]);
			if (namespaceData === undefined)
				return [];
			return namespaceData.memberSuggestions;
		}
		const variableOrClassSuggestionRegExp = /(?:[\s([{+\-*/!=<>&|,])(?:[a-zA-Z][a-zA-Z0-9_]*)?$/;
		const variableOrClassSuggestionRegExpRes = variableOrClassSuggestionRegExp.exec(line);
		if (variableOrClassSuggestionRegExpRes !== null) {
			let result: CompletionItem[] = [];
			for (const [_variableName, variableArray] of documentData.variables.entries())
				for (const variable of variableArray)
					if (variable.lineDeclared < textDocumentPosition.position.line
						&& (variable.lineUndeclared === undefined || variable.lineUndeclared > textDocumentPosition.position.line))
						result.push(variable.suggestion);
			if (activeNamespace !== undefined) {
				const currentNamespace = namespaces.get(activeNamespace);
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
		const classMemberSuggestionRegExp = /\.([a-z][a-zA-Z0-9_]*)?$/;
		const classMemberSuggestionRegExpRes = classMemberSuggestionRegExp.exec(line);
		if (classMemberSuggestionRegExpRes !== null) {
			const callChain = parseCallChain(line);
			const lastNameAndType = getLastNameAndTypeFromCallChain(callChain, documentData, activeNamespace, textDocumentPosition.position.line);
			if (lastNameAndType === undefined)
				return [];

			const currentClassInfo = classes.get(lastNameAndType.type);
			if (currentClassInfo === undefined)
				return [];
			return currentClassInfo.memberSuggestions;
		}
		return [];
	}
);

connection.onNotification('processDefaultNamespaces', (text: string) => {
	parseNamespaceFile(text, defaultNamespaces, classes);
	defaultNamespaces.forEach((value: NamespaceInfo, key: string) => {
		namespaces.set(key, value);
	});
});

interface NamespaceFunction {
	namespaceName: string,
	functionName: string
}
interface ClassConstructor {
	namespaceName: string,
	className: string,
	constructorSignature: string
}
interface ClassMethod {
	namespaceName: string,
	className: string,
	methodName: string
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
	update: boolean // only update or do full upload (for .nms files)
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
							methodName: functionRegExpRes[2]
						});
					}
					else if (constructorRegExpRes !== null) {
						memberDefinitionsLines.push(`@bypass /type constructor define ${namespaceName} ${lines[k].trim()}`);
						constructors.push({
							namespaceName: namespaceName,
							className: className,
							constructorSignature: getConstructorSignature(constructorRegExpRes[1], constructorRegExpRes[2])
						});
					}
					else if (variableRegExpRes !== null) {
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
					functionName: functionRegExpRes[2]
				});
			}
			else if (variableRegExpRes !== null) {
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

	connection.sendNotification('Upload namespace script', result);
});

function validateTextDocument(textDocument: TextDocument): void {

	const diagnostics: Diagnostic[] = [];

	// Get the text content of the document
	const text = textDocument.getText();

	if (text.includes("# msc-ignore-errors")) {
		connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [] });
		return;
	}

	let hasCooldown = false;
	let hasGlobalCooldown = false;
	let hasCancel = false;
	let scriptStarted = false;

	// Split the text into lines
	const lines = text.split('\n');

	// Define the valid line starters
	const validStarters = [
		'@if', '@elseif', '@else', '@fi', '@for', '@done', '@define', '@var',
		'@player', '@chatscript', '@prompt', '@delay', '@command', '@bypass',
		'@console', '@cooldown', '@global_cooldown', '@using', '@cancel',
		'@fast', '@slow', '@return'
	];

	// Iterate through each line
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		const firstWord = line.split(" ")[0];

		// Skip empty lines or lines starting with comments
		if (line === '' || line.startsWith("# ")) {
			continue;
		}

		if (!scriptStarted && !validStarters.includes(firstWord)) {
			scriptStarted = true;
		}

		// Skip empty lines or lines starting with valid starters or comments
		if (validStarters.includes(firstWord)) {
			// Additional checks for specific options
			if (firstWord === '@else' || firstWord === '@fi' || firstWord === '@done') {
				if (line !== firstWord) {
					const diagnostic: Diagnostic = {
						severity: DiagnosticSeverity.Error,
						range: {
							start: { line: i, character: lines[i].indexOf(firstWord) + firstWord.length },
							end: { line: i, character: lines[i].length }
						},
						message: `${firstWord} should be on its own line.`,
						source: 'msc-error'
					};
					diagnostics.push(diagnostic);
				}
			} else if (firstWord === '@for') {
				const forRegex = /^@for\s+([\w:]+)\s+(\w+)\s+in\s+(.+)$/;
				const match = line.match(forRegex);
				if (!match) {
					const diagnostic: Diagnostic = {
						severity: DiagnosticSeverity.Error,
						range: {
							start: { line: i, character: lines[i].indexOf(firstWord) },
							end: { line: i, character: lines[i].length }
						},
						message: 'Invalid @for syntax: expected @for <type> <variable> in <list>',
						source: 'msc-error'
					};
					diagnostics.push(diagnostic);
				}
			} else if (firstWord === '@define') {
				const defineRegex = /^@define\s+([\w:]+)\s+([a-z][\w]*)\s*(?:=\s*(.+))?$/;
				const match = line.match(defineRegex);
				if (!match) {
					const diagnostic: Diagnostic = {
						severity: DiagnosticSeverity.Error,
						range: {
							start: { line: i, character: lines[i].indexOf(firstWord) },
							end: { line: i, character: lines[i].length }
						},
						message: 'Invalid @define syntax. Expected: @define type variable [= expression]',
						source: 'msc-error'
					};
					diagnostics.push(diagnostic);
				} else {
					const [, _, __, expression] = match;
					if (expression === undefined && line.includes('=')) {
						const diagnostic: Diagnostic = {
							severity: DiagnosticSeverity.Error,
							range: {
								start: { line: i, character: lines[i].indexOf('=') },
								end: { line: i, character: lines[i].length }
							},
							message: 'Invalid @define syntax. Expression cannot be empty',
							source: 'msc-error'
						};
						diagnostics.push(diagnostic);
					}
				}
			} else if (firstWord === '@chatscript') {
				const chatscriptRegex = /^@chatscript\s+(\d+[tshmd]?)\s+(\S+)\s+(\S+)$/;
				const match = line.match(chatscriptRegex);
				if (!match) {
					const timeRegex = /^@chatscript\s+(\S+)/;
					const timeMatch = line.match(timeRegex);
					if (timeMatch) {
						const [, invalidTime] = timeMatch;
						const diagnostic: Diagnostic = {
							severity: DiagnosticSeverity.Error,
							range: {
								start: { line: i, character: lines[i].indexOf(invalidTime) },
								end: { line: i, character: lines[i].indexOf(invalidTime) + invalidTime.length }
							},
							message: 'Invalid time syntax in @chatscript. Expected: number with t/s/h/m/d',
							source: 'msc-error'
						};
						diagnostics.push(diagnostic);
					} else {
						const diagnostic: Diagnostic = {
							severity: DiagnosticSeverity.Error,
							range: {
								start: { line: i, character: lines[i].indexOf(firstWord) },
								end: { line: i, character: lines[i].length }
							},
							message: 'Invalid @chatscript syntax. Expected: @chatscript time group-name function',
							source: 'msc-error'
						};
						diagnostics.push(diagnostic);
					}
				} else {
					const [, _, __, func] = match;
					if (!func.includes('(') || !func.includes(')') || func.indexOf('(') >= func.indexOf(')')) {
						const diagnostic: Diagnostic = {
							severity: DiagnosticSeverity.Error,
							range: {
								start: { line: i, character: lines[i].indexOf(func) },
								end: { line: i, character: lines[i].indexOf(func) + func.length }
							},
							message: 'Invalid function syntax in @chatscript. Expected: function()',
							source: 'msc-error'
						};
						diagnostics.push(diagnostic);
					}
				}
			} else if (firstWord === '@cooldown' || firstWord === '@global_cooldown') {
				if (scriptStarted) {
					const diagnostic: Diagnostic = {
						severity: DiagnosticSeverity.Error,
						range: {
							start: { line: i, character: lines[i].indexOf(firstWord) },
							end: { line: i, character: lines[i].length }
						},
						message: `${firstWord} must appear at the beginning of the script`,
						source: 'msc-error'
					};
					diagnostics.push(diagnostic);
				} else if ((firstWord === '@cooldown' && hasCooldown) || (firstWord === '@global_cooldown' && hasGlobalCooldown)) {
					const diagnostic: Diagnostic = {
						severity: DiagnosticSeverity.Error,
						range: {
							start: { line: i, character: lines[i].indexOf(firstWord) },
							end: { line: i, character: lines[i].length }
						},
						message: `${firstWord} can only appear once in the script`,
						source: 'msc-error'
					};
					diagnostics.push(diagnostic);
				} else {
					if (firstWord === '@cooldown') {
						hasCooldown = true;
					} else {
						hasGlobalCooldown = true;
					}
					const cooldownRegex = /^@(cooldown|global_cooldown)\s+(\d+[tshmd]?)$/;
					const match = line.match(cooldownRegex);
					if (!match) {
						const diagnostic: Diagnostic = {
							severity: DiagnosticSeverity.Error,
							range: {
								start: { line: i, character: lines[i].indexOf(firstWord) },
								end: { line: i, character: lines[i].length }
							},
							message: `Invalid ${firstWord} syntax. Expected: ${firstWord} time`,
							source: 'msc-error'
						};
						diagnostics.push(diagnostic);
					}
				}
			} else if (firstWord === '@cancel') {
				if (scriptStarted) {
					const diagnostic: Diagnostic = {
						severity: DiagnosticSeverity.Error,
						range: {
							start: { line: i, character: lines[i].indexOf(firstWord) },
							end: { line: i, character: lines[i].length }
						},
						message: '@cancel must appear at the beginning of the script',
						source: 'msc-error'
					};
					diagnostics.push(diagnostic);
				} else if (hasCancel) {
					const diagnostic: Diagnostic = {
						severity: DiagnosticSeverity.Error,
						range: {
							start: { line: i, character: lines[i].indexOf(firstWord) },
							end: { line: i, character: lines[i].length }
						},
						message: '@cancel can only appear once in the script',
						source: 'msc-error'
					};
					diagnostics.push(diagnostic);
				} else {
					hasCancel = true;
					if (line !== '@cancel') {
						const diagnostic: Diagnostic = {
							severity: DiagnosticSeverity.Error,
							range: {
								start: { line: i, character: lines[i].indexOf(firstWord) + firstWord.length },
								end: { line: i, character: lines[i].length }
							},
							message: '@cancel should not have anything else on the line',
							source: 'msc-error'
						};
						diagnostics.push(diagnostic);
					}
				}
			}
			continue;
		} else {

			// Create a diagnostic for the invalid line
			const diagnostic: Diagnostic = {
				severity: DiagnosticSeverity.Error,
				range: {
					start: { line: i, character: lines[i].indexOf(firstWord) },
					end: { line: i, character: lines[i].indexOf(firstWord) + firstWord.length }
				},
				message: 'Invalid script option ' + firstWord,
				source: 'msc-error'
			};

			// Add the diagnostic to the array
			diagnostics.push(diagnostic);
		}
	}

	// Check for mutually exclusive options
	if ((+hasCooldown + +hasGlobalCooldown + +hasCancel) > 1) {
		const diagnostic: Diagnostic = {
			severity: DiagnosticSeverity.Error,
			range: {
				start: { line: 0, character: 0 },
				end: { line: 0, character: 0 }
			},
			message: '@cooldown, @global_cooldown, and @cancel are mutually exclusive',
			source: 'msc-error'
		};
		diagnostics.push(diagnostic);
	}

	// Send the diagnostics to the client
	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [] });
	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}



// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Register the text document validation function
documents.onDidSave(change => {
	validateTextDocument(change.document);
});

// Register the text document validation function
documents.onDidOpen(change => {
	validateTextDocument(change.document);
});

documents.onDidChangeContent(e => {
	sourceFileData.set(e.document.uri, parseDocument(e.document.getText()));
	validateTextDocument(e.document);
});

documents.onDidClose(e => {
	sourceFileData.delete(e.document.uri);
});

connection.onDidChangeWatchedFiles(_ => {
	refreshNamespaceFiles();
});

// Listen on the connection
connection.listen();
