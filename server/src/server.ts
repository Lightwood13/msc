/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
	createConnection,
	TextDocuments,
	ProposedFeatures,
	InitializeParams,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	InitializeResult,
	MarkupKind,
	InsertTextFormat
} from 'vscode-languageserver/node';

import {
	TextDocument
} from 'vscode-languageserver-textdocument';
import {
	SignatureHelp,
	SignatureInformation,
	ParameterInformation,
	Hover,
	HoverParams,
	SignatureHelpParams
} from 'vscode-languageserver-protocol';
import { readdir, readFile } from 'fs';

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
	connection.sendNotification('getDefaultNamespace');
	refreshNamespaceFiles();
});

interface VariableInfo {
	type: string;
	lineDeclared: number;
	lineUndeclared: number | undefined;
	suggestion: CompletionItem;
}
interface MemberInfo {
	name: string,
	returnType: string,
	documentation: string | undefined,
	suggestion: CompletionItem | undefined,
	signature: SignatureInformation | undefined;
}
interface NamespaceInfo {
	members: Map<string, MemberInfo>;
	memberSignatures: Map<string, SignatureInformation[] | undefined>;
	memberSuggestions: CompletionItem[];
}
type ClassInfo = NamespaceInfo;
interface UsingDeclaration {
	lineDeclared: number,
	namespace: string
}
interface SourceFileData{
	variables: Map<string, VariableInfo[]>,
	usingDeclarations: UsingDeclaration[]
}

const sourceFileData: Map<string, Thenable<SourceFileData>> = new Map();
const namespaces: Map<string, NamespaceInfo> = new Map();
const classes: Map<string, ClassInfo> = new Map();
let snippets: CompletionItem[] = [];
const snippetsWithoutAtSymbol: CompletionItem[] = [];

const newLineRegExp = /\r?\n/;
const allowedTypeNameWithNamespaceRegExp = /^([a-zA-Z][a-zA-Z0-9_]*::)?[A-Z][a-zA-Z0-9_]*(\[\])?$/;
const allowedNameRegExp = /^[a-z][a-zA-Z0-9_]*$/;
const namespaceSignatureRegExp = /^\s*@namespace\s+([a-zA-Z][a-zA-Z0-9_]*|__default__)\s*$/;
const classSignatureRegExp = /^\s*@class\s+([A-Z][a-zA-Z0-9_]*)\s*$/;
const functionSignatureRegExp = /^\s*((?:[a-zA-Z][a-zA-Z0-9_]*::)?[A-Z][a-zA-Z0-9_]*(?:\[\])?)?\s+([a-z][a-zA-Z0-9_]*)\s*(\(.*\))\s*$/;
const constructorSignatureRegExp = /^\s*([A-Z][a-zA-Z0-9_]*)\s*(\(.*\))\s*$/;
const variableSignatureRegExp = /^\s*(relative\s+)?((?:[a-zA-Z][a-zA-Z0-9_]*::)?[A-Z][a-zA-Z0-9_]*(?:\[\])?)\s+([a-z][a-zA-Z0-9_]*)(?:\s*=.*)?\s*$/;
const commentRegExp = /^\s*#\s*(.*)\s*$/;
const firstLineCommentRegExp = /^\s*#(?:.*\()?(\s*,?\s*([a-zA-Z][a-zA-Z0-9_]*::)?[A-Z][a-zA-Z0-9_]*(\[\])?\s+[a-z][a-zA-Z0-9_]*)+(?:\s*\)\s*)?$/;

function refreshNamespaceFiles() {
	readdir('.', (err, files) => {
		if (err)
			return console.log('Unable to scan directory: ' + err);
		for (const filename of files) {
			const filenamesSplit = filename.split('.');
			if (filenamesSplit[filenamesSplit.length - 1] == 'nms') {
				readFile(filename, (err, data) => {
					if (err)
						return console.log('Unable to read file: ' + err);
					parseNamespaceFile(data.toString(), namespaces, classes);
				});
			}
		}
	});
}

function parseNamespaceFile(text: string, namespaceStorage: Map<string, NamespaceInfo>,
	classStorage: Map<string, ClassInfo>) {
	const lines = text.split(newLineRegExp);
	for (let i = 0; i < lines.length; i++)
	{
		const regExpRes = namespaceSignatureRegExp.exec(lines[i]);
		if (regExpRes === null)
			continue;
		let j = i;
		for (j = i; j < lines.length; j++)
		{
			if (lines[j].trim() == '@endnamespace')
				break;
		}
		if (j == lines.length)
			break;
		namespaceStorage.set(regExpRes[1], parseNamespace(regExpRes[1], lines.slice(i + 1, j), classStorage));
		i = j;
	}
}

function getArrayClassDefinition(name: string): string[] {
	const result = [
		`add(${name} value, Int index)`,
		`append(${name} value)`,
		`clear()`,
		`Boolean contains(${name} value)`,
		`Int find(${name} value)`,
		`Int length()`,
		`${name} pop()`,
		`${name} remove(Int index)`,
		`Void reverse()`,
		`Void shuffle()`,
		`String string()`
	];
	if (['Int', 'Long', 'Float', 'Double'].includes(name)) {
		result.push(`Double avg()`);
		result.push(`${name} sum()`);
	}
	else if (name === 'String') {
		result.push('String concat()');
		result.push('String join(String delimiter)');
	}
	return result;
}

function parseNamespace(name: string, lines: string[], classStorage: Map<string, ClassInfo>): NamespaceInfo {
	const result: NamespaceInfo = {
		members: new Map(),
		memberSignatures: new Map(),
		memberSuggestions: []
	};
	for (let i = 0; i < lines.length; i++) {
		const classRegExpRes = classSignatureRegExp.exec(lines[i]);
		if (classRegExpRes === null) {
			const newMember = parseVariableOrFunctionAtLine(name + '::', lines, i);
			if (newMember !== null) {
				result.members.set(newMember.name, newMember);
				if (newMember.suggestion !== undefined)
					result.memberSuggestions.push(newMember.suggestion);
				if (newMember.signature !== undefined) {
					let signatures = result.memberSignatures.get(newMember.name);
					if (signatures === undefined)
						signatures = [];
					if (!signatures.includes(newMember.signature))
						signatures.push(newMember.signature);
					result.memberSignatures.set(newMember.name, signatures);
				}
			}
			continue;
		}

		const description = parseCommentsAboveLine(lines, i);

		let j = i;
		for (j = i; j < lines.length; j++) {
			if (lines[j].trim() == '@endclass')
				break;
		}
		if (j == lines.length)
			break;

		let className = classRegExpRes[1];
		if (name !== '__default__')
			className = name + '::' + className;
		classStorage.set(className, parseClass(className, lines.slice(i + 1, j)));
		classStorage.set(className + '[]', parseClass(className + '[]', getArrayClassDefinition(className)));
		i = j;
		const newClass: CompletionItem = {
			label: className,
			kind: CompletionItemKind.Class,
			detail: 'class ' + className
		};
		const newClassArray: CompletionItem = {
			label: className + '[]',
			kind: CompletionItemKind.Class,
			detail: 'class ' + className + '[]'
		};
		if (description.length !== 0)
			newClass.documentation = {
				kind: MarkupKind.Markdown,
				value: description
			};
		result.memberSuggestions.push(newClass);
		result.memberSuggestions.push(newClassArray);
	}
	return result;
}

function parseClass(name: string, lines: string[]): ClassInfo {
	const result: ClassInfo = {
		members: new Map(),
		memberSignatures: new Map(),
		memberSuggestions: []
	};
	for (let i = 0; i < lines.length; i++) {
		const newMember = parseVariableOrFunctionAtLine(name + '.', lines, i);
		if (newMember !== null) {
			result.members.set(newMember.name, newMember);
			if (newMember.suggestion !== undefined)
				result.memberSuggestions.push(newMember.suggestion);
			if (newMember.signature !== undefined) {
				let signatures = result.memberSignatures.get(newMember.name);
				if (signatures === undefined)
					signatures = [];
				if (!signatures.includes(newMember.signature))
					signatures.push(newMember.signature);
				result.memberSignatures.set(newMember.name, signatures);
			}
		}
	}
	return result;
}

function parseVariableOrFunctionAtLine(namePrefix: string, lines: string[], line: number): MemberInfo | null {
	const functionRegExpRes = functionSignatureRegExp.exec(lines[line]);
	const constructorRegExpRes = constructorSignatureRegExp.exec(lines[line]);
	const variableRegExpRes = variableSignatureRegExp.exec(lines[line]);
	if (functionRegExpRes === null && constructorRegExpRes === null && variableRegExpRes === null)
		return null;
	const description = parseCommentsAboveLine(lines, line);

	const result: MemberInfo = {
		returnType: '',
		name: '',
		suggestion:  {
			label: 'label'
		},
		signature: undefined,
		documentation: undefined
	};
	if (functionRegExpRes !== null) {
		result.name = functionRegExpRes[2] + '()';
		result.returnType = functionRegExpRes[1];
		result.suggestion = {
			label: functionRegExpRes[2],
			insertText: functionRegExpRes[2] + '($0)',
			insertTextFormat: InsertTextFormat.Snippet,
			kind: CompletionItemKind.Method,
			detail: lines[line].replace(functionSignatureRegExp, '$1 ' + namePrefix + '$2$3'),
			command: {
			title: 'Trigger Parameter Hints',
			command: 'editor.action.triggerParameterHints'
			}
		};
		if (result.suggestion.detail !== undefined)
			result.signature = {
				label: result.suggestion.detail,
				parameters: getParamsFromSignature(result.suggestion.detail)
			};
	}
	else if (constructorRegExpRes !== null) {
		result.name = constructorRegExpRes[1] + '()';
		result.returnType = constructorRegExpRes[1];
		result.suggestion = undefined;
		const temp = lines[line].replace(constructorSignatureRegExp, '$1$2');
		result.signature = {
			label: temp,
			parameters: getParamsFromSignature(temp)
		};
	}
	else if (variableRegExpRes !== null) {
		result.name = variableRegExpRes[3];
		result.returnType = variableRegExpRes[2];
		result.suggestion = {
			label: variableRegExpRes[3],
			kind: CompletionItemKind.Variable,
			detail: lines[line].replace(variableSignatureRegExp, (variableRegExpRes [1] !== '' ? 'relative ' : '') + '$2 ' + namePrefix + '$3')
		};
	}
	if (result.returnType === undefined)
		result.returnType = 'Void';
	if (description.length !== 0) {
		if (result.suggestion !== undefined)
			result.suggestion.documentation = {
				kind: MarkupKind.Markdown,
				value: description
			};
		if (result.signature !== undefined)
			result.signature.documentation = description;
		result.documentation = description;
	}
	return result;
}

function parseCommentsAboveLine(lines: string[], line: number): string {
	const descriptionArray: string[] = [];
	for (let j = line - 1; j >= 0; j--) {
		const commentRegExpRes = commentRegExp.exec(lines[j]);
		if (commentRegExpRes === null)
			break;
		descriptionArray.push(commentRegExpRes[1]);
	}
	descriptionArray.reverse();
	return descriptionArray.join(' ');
}

function getParamsFromSignature(signature: string): ParameterInformation[] {
	const result: ParameterInformation[] = [];
	const regExpRes = /\((.*)\)/.exec(signature);
	if (regExpRes === null)
		return [];
	const paramsString = regExpRes[1];
	const params = paramsString.split(',');
	for (const param of params) {
		result.push({
			label: param.trim()
		});
	}
	return result;
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
			resolve(parseDocument(document?.getText()));
	});
	sourceFileData.set(documentUri, result);
	return result;
}

// Only keep settings for open documents
documents.onDidClose(e => {
	sourceFileData.delete(e.document.uri);
});

async function parseDocument(text: string): Promise<SourceFileData> {
	const result: SourceFileData = 
	{
		variables: new Map(),
		usingDeclarations: [],
	};

	result.variables.set('player', [{
		lineDeclared: -1,
		lineUndeclared: undefined,
		type: 'Player',
		suggestion: {
			label: 'player',
			kind: CompletionItemKind.Variable,
			detail: 'Player player'
		}
	}]);
	result.variables.set('block', [{
		lineDeclared: -1,
		lineUndeclared: undefined,
		type: 'Block',
		suggestion: {
			label: 'block',
			kind: CompletionItemKind.Variable,
			detail: 'Block block'
		}
	}]);

	const lines = text.split(newLineRegExp);
	if (lines.length !== 0 && firstLineCommentRegExp.test(lines[0])) {
		const openingBracketPos = lines[0].indexOf('(');
		const closingBracketPos = lines[0].indexOf(')');

		const paramListStart = (openingBracketPos === -1) ? lines[0].indexOf('#') : openingBracketPos;
		const paramListEnd = (closingBracketPos === -1) ? lines[0].length : closingBracketPos;
		const params = lines[0].substring(paramListStart + 1, paramListEnd).split(',');
		for (const param of params) {
			const regExpRes = /((?:[a-zA-Z][a-zA-Z0-9_]*::)?[A-Z][a-zA-Z0-9_]*(?:\[\])?)\s+([a-z][a-zA-Z0-9_]*)/.exec(param);
			if (regExpRes === null)
				continue;
			result.variables.set(regExpRes[2], [{
				lineDeclared: 0,
				lineUndeclared: undefined,
				type: regExpRes[1],
				suggestion: {
					label: regExpRes[2],
					kind: CompletionItemKind.Variable,
					detail: regExpRes[1] + ' ' + regExpRes[2]
				}
			}]);
		}
	}
	const forLoopVariableStack: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const tokens = lines[i].trim().split(/\s+/);
		if (tokens.length >= 3 && (tokens[0] === '@define' || tokens[0] === '@for')) {
			if (!allowedTypeNameWithNamespaceRegExp.test(tokens[1]) || !allowedNameRegExp.test(tokens[2]))
				continue;
			let sameNameVariables = result.variables.get(tokens[2]);
			if (sameNameVariables === undefined)
				sameNameVariables = [];
			sameNameVariables.push({
				lineDeclared: i,
				lineUndeclared: undefined,
				type: tokens[1],
				suggestion: {
					label: tokens[2],
					kind: CompletionItemKind.Variable,
					detail: tokens[1] + ' ' + tokens[2]
				}
			});
			result.variables.set(tokens[2], sameNameVariables);
			if (tokens[0] === '@for')
				forLoopVariableStack.push(tokens[2]);
		}
		else if (tokens.length === 1 && tokens[0] === '@done') {
			const loopVariableName = forLoopVariableStack.pop();
			if (loopVariableName === undefined)
				continue;
			const loopVariable = result.variables.get(loopVariableName);
			if (loopVariable === undefined)
				continue;
			loopVariable[loopVariable.length - 1].lineUndeclared = i;
		}
		else if (tokens.length === 2 && tokens[0] === '@using')
			result.usingDeclarations.push({
				lineDeclared: i,
				namespace: tokens[1]
			});
	}
	return result;
}

connection.onDidChangeWatchedFiles(change => {
	refreshNamespaceFiles();
});

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
			// skip method call
			let isFunction = false;
			if (line[i - 1] === ')') {
				isFunction = true;
				let openParenthesesCount = 0;
				let openQuotesCount = 0;
				let j = i - 1;
				for (; j >= 0; j--) {
					const d = line[j];
					if (d === '"' && (j === 0 || line[j - 1] != '\\'))
						openQuotesCount = 1 - openQuotesCount;
					else if (d === ')' && openQuotesCount === 0)
						openParenthesesCount++;
					else if (d === '(' && openQuotesCount === 0)
						openParenthesesCount--;
					if (openParenthesesCount === 0)
						break;
				}
				if (j === -1)
					return [];
				i = j;
			}
			if (i === 0)
				return [];
			let k = i - 1;
			for (; k >= 0; k--) {
				if (/[.:\s([{+\-*/!=<>&|,]/.test(line[k]))
					break;
				if (!/[a-zA-Z0-9_]/.test(line[k]))
					return [];
			}
			if (k === -1)
				return [];
			result.push(line.substring(k + 1, i) + (isFunction ? '()' : ''));
			i = k;
		}
		else if (line[i] === ':') {
			if (scopeOperatorUsed || i < 2 || line[i - 1] !== ':')
				return [];
			scopeOperatorUsed = true;
			let k = i - 2;
			for (; k >= 0; k--) {
				if (/[.:\s([{+\-*/!=<>&|,]/.test(line[k]))
					break;
				if (!/[a-zA-Z0-9_]/.test(line[k]))
					return [];
			}
			if (k === -1)
				return [];
			result.push(line.substring(k + 1, i + 1));
			i = k;
		}
		else if (/[.:\s([{+\-*/!=<>&|,]/.test(line[i]))
			return result.reverse();
		else
			return [];
	}
	return [];
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
		if (line[i] == '"') {
			if (i === 0)
				return undefined;
			let j = i - 1;
			for (; j >= 0; j--) {
				if (line[j] === '"' && (j === 0 || line[j - 1] != '\\'))
					break;
			}
			if (j === -1)
				return undefined;
			i = j;
		}
		else if (line[i] === ',')
			paramNumber++;
		else if (line[i] === ')') {
			let openParenthesesCount = 0;
			let openQuotesCount = 0;
			let j = i;
			for (; j >= 0; j--) {
				const d = line[j];
				if (d === '"' && (j === 0 || line[j - 1] != '\\'))
					openQuotesCount = 1 - openQuotesCount;
				else if (d === ')' && openQuotesCount === 0)
					openParenthesesCount++;
				else if (d === '(' && openQuotesCount === 0)
					openParenthesesCount--;
				if (openParenthesesCount === 0)
					break;
			}
			if (j === -1)
				return undefined;
			i = j;
		}
		else if (line[i] === '(') {
			if (i === 0)
				return undefined;
			if (/[\s([+\-*/!=<>&|,]/.test(line[i - 1])) {
				paramNumber = 0;
				continue;
			}
			if (!/[a-zA-Z0-9_]/.test(line[i - 1]))
				return undefined;
			const callChain = parseCallChain(line.substring(0, i) + '().a');
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

interface NameAndType {
	name: string,
	type: string
}

function getLastNameAndTypeFromCallChain(callChain: string[], currentDocumentData: SourceFileData,
	activeNamespace: string | undefined, lineNumber: number): NameAndType | undefined {
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
				if (activeNamespace === undefined)
					return undefined;
				const currentNamespace = namespaces.get(activeNamespace);
				if (currentNamespace === undefined)
					return undefined;
				const currentMember = currentNamespace.members.get(callChain[0]);
				if (currentMember === undefined)
					return undefined;
				currentName = activeNamespace + '::' + callChain[0];
				currentClass = currentMember.returnType;
			}
			
		}
	}

	for (let i = startingI; i < callChain.length; i++) {
		let currentClassInfo = classes.get(currentClass);
		if (currentClassInfo === undefined) {
			if (i !== startingI || activeNamespace === undefined)
				return undefined;
			currentClassInfo = classes.get(activeNamespace + '::' + currentClass);
			if (currentClassInfo === undefined)
				return undefined;
			currentClass = activeNamespace + '::' + currentClass;
		}
		const nextClass = currentClassInfo.members.get(callChain[i]);
		if (nextClass === undefined)
			return undefined;
		currentName = currentClass + '.' + callChain[i];
		currentClass = nextClass.returnType;
	}

	let currentClassWithoutArray = currentClass;
	if (currentClass.endsWith('[]'))
		currentClassWithoutArray = currentClass.substring(0, currentClass.length - 2);
	if (!classes.has(currentClassWithoutArray)) {
		if (classes.has(activeNamespace + '::' + currentClassWithoutArray))
			currentClass = activeNamespace + '::' + currentClass;
		else
			return undefined;
	}

	return {
		name: currentName,
		type: currentClass
	};
}

function findActiveNamespace(usingDeclarations: UsingDeclaration[], line: number) : string | undefined {
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
				&& /[a-z]/.test(name[scopeOperatorPosition + 2]) ) {
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
			else if (dotPosition !== -1)
			{
				// class method call
				const className = name.substring(0, dotPosition);
				const methodName = name.substring(dotPosition + 1);
				const currentClass = classes.get(className);
				//fix call chain
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
		for(; i < line.length; i++) {
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
		const snippetSuggestionRegExp = /^\s*(@)?[a-z]+$/;
		const snippetSuggestionRegExpRes = snippetSuggestionRegExp.exec(line);
		if (snippetSuggestionRegExpRes !== null) {
			if (snippetSuggestionRegExpRes[1] === undefined)
				return snippets;
			else
				return snippetsWithoutAtSymbol;
		}
		const namespaceSuggestionRegExp = /(?:^|[\s([{+\-*/!=<>&|,])([a-zA-Z][a-zA-Z0-9_]*)::[a-zA-Z0-9_]*$/;
		const namespaceSuggestionRegExpRes = namespaceSuggestionRegExp.exec(line);
		if (namespaceSuggestionRegExpRes !== null) {
			const namespaceData = namespaces.get(namespaceSuggestionRegExpRes[1]);
			if (namespaceData === undefined)
				return [];
			return namespaceData.memberSuggestions;
		}
		const variableOrClassSuggestionRegExp = /(?:^|[\s([{+\-*/!=<>&|,])[a-zA-Z][a-zA-Z0-9_]*$/;
		const variableOrClassSuggestionRegExpRes = variableOrClassSuggestionRegExp.exec(line);
		if (variableOrClassSuggestionRegExpRes !== null) {
			let result: CompletionItem[] = [];
			for (const [variableName, variableArray] of documentData.variables.entries())
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
			for (const [namespaceName, namespaceInfo] of namespaces) {
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

interface Temp {
	documentUri: string,
	documentText: string
}

connection.onNotification('updateDocument', (document: Temp) => {
	sourceFileData.set(document.documentUri, parseDocument(document.documentText));
});

connection.onNotification('processDefaultNamespace', (text: string) => {
	parseNamespaceFile(text, namespaces, classes);
});

connection.onNotification('addSnippets', (_snippets: CompletionItem[]) => {
	snippets = _snippets;
	for (const snippet of snippets) {
		const modifiedSnippet: CompletionItem = {
			...snippet
		};
		modifiedSnippet.insertText = snippet.insertText?.substring(1);
		snippetsWithoutAtSymbol.push(modifiedSnippet);
	}
});

interface DocumentContents {
	text: string
}
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
	document: DocumentContents, 
	defineScript: string,
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

connection.onNotification('Export namespace', (document: DocumentContents) => {
	const lines = document.text.split(newLineRegExp);
	const resultLines: string[] = [];
	const functions: NamespaceFunction[] = [];
	const methods: ClassMethod[] = [];
	const constructors: ClassConstructor[] = [];
	for (let i = 0; i < lines.length; i++)
	{
		const regExpRes = namespaceSignatureRegExp.exec(lines[i]);
		if (regExpRes === null)
			continue;
		let namespaceEndLine = i;
		for (namespaceEndLine = i; namespaceEndLine < lines.length; namespaceEndLine++)
		{
			if (lines[namespaceEndLine].trim() == '@endnamespace')
				break;
		}
		if (namespaceEndLine == lines.length)
			break;
		const namespaceName: string = regExpRes[1];
		resultLines.push(`@bypass /namespace remove ${namespaceName}`);
		resultLines.push(`@bypass /namespace define ${namespaceName}`);
		
		for (let j = i + 1; j < namespaceEndLine; j++) {
			const classRegExpRes = classSignatureRegExp.exec(lines[j]);
			if (classRegExpRes !== null) {
				let classEndLine = j;
				for (; classEndLine < namespaceEndLine; classEndLine++)
				{
					if (lines[classEndLine].trim() == '@endclass')
						break;
				}
				if (classEndLine == namespaceEndLine)
					break;
				const className = classRegExpRes[1];
				resultLines.push(`@bypass /type define ${namespaceName} ${className}`);
				
				for (let k = j + 1; k < classEndLine; k++) {
					const functionRegExpRes = functionSignatureRegExp.exec(lines[k]);
					const constructorRegExpRes = constructorSignatureRegExp.exec(lines[k]);
					const variableRegExpRes = variableSignatureRegExp.exec(lines[k]);
					if (functionRegExpRes !== null) {
						resultLines.push(`@bypass /type method define ${namespaceName} ${className} ${lines[k].trim()}`);
						methods.push({
							namespaceName: namespaceName,
							className: className,
							methodName: functionRegExpRes[2]
						});
					}
					else if (constructorRegExpRes !== null) {
						resultLines.push(`@bypass /type constructor define ${namespaceName} ${lines[k].trim()}`);
						constructors.push({
							namespaceName: namespaceName,
							className: className,
							constructorSignature: getConstructorSignature(constructorRegExpRes[1], constructorRegExpRes[2])
						});
					}
					else if (variableRegExpRes !== null)
						resultLines.push(`@bypass /type field define ${namespaceName} ${className} ${lines[k].trim()}`);
				}
				
				j = classEndLine;
				continue;
			}
			const functionRegExpRes = functionSignatureRegExp.exec(lines[j]);
			const variableRegExpRes = variableSignatureRegExp.exec(lines[j]);
			if (functionRegExpRes !== null) {
				resultLines.push(`@bypass /function define ${namespaceName} ${lines[j].trim()}`);
				functions.push({
					namespaceName: namespaceName,
					functionName: functionRegExpRes[2]
				});
			}
			else if (variableRegExpRes !== null)
				resultLines.push(`@bypass /variable define ${namespaceName} ${lines[j].trim()}`);
			}

		i = namespaceEndLine;
	}
	const script: string = resultLines.join('\n');
	const result: NamespaceUploadResult = {
		document: document,
		defineScript: script,
		functions: functions, 
		constructors: constructors,
		methods: methods
	};
	connection.sendNotification('Upload namespace script', result);
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
