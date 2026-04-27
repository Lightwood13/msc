/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
	createConnection,
	TextDocuments,
	Diagnostic,
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
	Position,
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
	readFile
} from 'fs';
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
	VariableInfo,
	NamespaceInfo,
	ClassInfo,
	DefinitionLocation,
	UsingDeclaration,
	SourceFileData,
	parseNamespaceFile,
	newLineRegExp,
	namespaceSignatureRegExp,
	classSignatureRegExp,
	functionSignatureRegExp,
	constructorSignatureRegExp,
	variableSignatureRegExp,
	parseDocument,
	NameAndType
} from './parser';
import {
	keywords,
	keywordsWithoutAtSymbol,
	minecraftCommands
} from './keywords';
import { DiagnosticData, Fix, lineOpsToEdits, parseSuppressions, raise } from './lint';
import { RULES } from './rules';

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
	refreshNamespaceFiles();
});

const sourceFileData: Map<string, Thenable<SourceFileData>> = new Map();
const defaultNamespaces: Map<string, NamespaceInfo> = new Map();
const namespaces: Map<string, NamespaceInfo> = new Map();
const classes: Map<string, ClassInfo> = new Map();
const implicitThisTypeCache: Map<string, string | undefined> = new Map();
let defaultNamespacesSourceUri: string = '';

function refreshNamespaceFiles() {
	// search for .nms files in all subfolders
	files('.', (err, files) => {
		if (err)
			return console.log('Unable to scan directory: ' + err);
		namespaces.clear();
		implicitThisTypeCache.clear();
		defaultNamespaces.forEach((value: NamespaceInfo, key: string) => {
			namespaces.set(key, value);
		});
			for (const filename of files) {
				const filenamesSplit = filename.split('.');
				if (filenamesSplit[filenamesSplit.length - 1] === 'nms') {
					readFile(filename, (err, data) => {
						if (err) return console.log('Unable to read file: ' + err);
						parseNamespaceFile(data.toString(), namespaces, classes, pathToFileURL(resolve(filename)).toString());
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
	const result = (async () => {
		const document = documents.get(documentUri);
		if (document === undefined) {
			console.log('Couldn\'t read file ' + documentUri);
			return {
				variables: new Map(),
				usingDeclarations: []
			};
		}

		const implicitThisType = await resolveImplicitThisType(documentUri);
		return parseDocument(document.getText(),
			implicitThisType === undefined ? [] : [{ name: 'this', type: implicitThisType }]);
	})();
	sourceFileData.set(documentUri, result);
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

function collectImplicitThisType(namespaceDefinitionPath: string, text: string, targetPath: string): string | undefined {
	const normalizedTargetPath = normalize(targetPath);
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
		for (let j = i + 1; j < namespaceEndLine; j++) {
			const classMatch = classSignatureRegExp.exec(lines[j]);
			if (classMatch === null)
				continue;

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
					if (methodPath === normalizedTargetPath)
						return classType;
				} else if (constructorMatch !== null) {
					const constructorSignature = getConstructorSignature(constructorMatch[1], constructorMatch[2]);
					const constructorPath = normalize(join(namespaceFolderPath, className, `${constructorSignature}.msc`));
					if (constructorPath === normalizedTargetPath)
						return classType;
				}
			}

			j = classEndLine;
		}

		i = namespaceEndLine;
	}

	return undefined;
}

async function resolveImplicitThisType(documentUri: string): Promise<string | undefined> {
	if (implicitThisTypeCache.has(documentUri))
		return implicitThisTypeCache.get(documentUri);

	const result = await computeImplicitThisType(documentUri);
	implicitThisTypeCache.set(documentUri, result);
	return result;
}

async function computeImplicitThisType(documentUri: string): Promise<string | undefined> {
	let targetPath: string;
	try {
		targetPath = normalize(fileURLToPath(documentUri));
	} catch (_err) {
		return undefined;
	}

	const scriptFileName = basename(targetPath, extname(targetPath));
	if (scriptFileName === '__init__')
		return undefined;

	const scriptDirectoryPath = dirname(targetPath);
	const directNamespaceName = basename(scriptDirectoryPath);
	const directNamespaceDefinitionPath = join(dirname(scriptDirectoryPath), `${directNamespaceName}.nms`);

	// if the file is directly inside a namespace folder, it's a namespace function — no implicit this
	if (await fileExists(directNamespaceDefinitionPath))
		return undefined;

	const enclosingNamespaceDirectoryPath = dirname(scriptDirectoryPath);
	const nestedNamespaceName = basename(enclosingNamespaceDirectoryPath);
	const nestedNamespaceDefinitionPath = join(dirname(enclosingNamespaceDirectoryPath), `${nestedNamespaceName}.nms`);

	try {
		const text = await readFileAsync(nestedNamespaceDefinitionPath, 'utf8');
		return collectImplicitThisType(nestedNamespaceDefinitionPath, text, targetPath);
	} catch (_err) {
		return undefined;
	}
}

function skipStringBackward(line: string, pos: number): number | undefined {
	const stack: string[] = [];
	for (; pos >= 0; pos--) {
		if (line[pos] === '"') {
			if (stack.length === 0 || stack[stack.length - 1] !== '"') {
				stack.push('"');
			} else if (pos === 0 || line[pos - 1] !== '\\') {
				stack.pop();
				if (stack.length === 0)
					return pos;
			}
		} else if (line[pos] === '}' && pos >= 1 && line[pos - 1] === '}' &&
			(pos === 1 || line[pos - 2] !== '\\')) {
			if (stack.length !== 0 && stack[stack.length - 1] === '"') {
				stack.push('}');
			} else {
				return undefined;
			}
		} else if (line[pos] === '{' && pos >= 1 && line[pos - 1] === '{' &&
			(pos === 1 || line[pos - 2] !== '\\')) {
			if (stack.length !== 0 && stack[stack.length - 1] === '}') {
				stack.pop();
			} else {
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
		} else if (c === closingParentheses)
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
		} else if (line[i] === ':') {
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
		} else if (/[.\s([{+\-*/%^!=<>&|,]/.test(line[i]))
			return result.reverse();
		else
			return [];
	}
	return [];
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
		} else {
			const currentNamespaceInfo = namespaces.get(callChain[0].substring(0, callChain[0].length - 2));
			if (currentNamespaceInfo === undefined)
				return undefined;
			const currentNamespaceMember = currentNamespaceInfo.members.get(callChain[1]);
			if (currentNamespaceMember === undefined)
				return undefined;
			currentClass = currentNamespaceMember.returnType;
		}
	} else {
		currentName = callChain[0];
		if (/[A-Z]/.test(callChain[0][0])) {
			if (!callChain[0].endsWith('()'))
				return undefined;
			currentClass = callChain[0].substring(0, callChain[0].length - 2);
		} else {
			const currentVariables = currentDocumentData.variables.get(callChain[0]);
			let currentVariable: VariableInfo | undefined = undefined;
			if (currentVariables !== undefined)
				for (const variable of currentVariables)
					if (variable.lineDeclared < lineNumber && (variable.lineUndeclared === undefined ||
						variable.lineUndeclared > lineNumber))
						currentVariable = variable;
			if (currentVariable !== undefined) {
				currentClass = currentVariable.type;
			} else {
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
		} else if (line[i] === ')' || line[i] === ']') {
			const j = skipParenthesizedExpression(line, i, line[i]);
			if (j === undefined)
				return undefined;
			i = j;
		} else if (line[i] === '[')
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

function getLineText(document: TextDocument, lineNumber: number): string {
	return document.getText({
		start: {
			line: lineNumber,
			character: 0
		},
		end: {
			line: lineNumber + 1,
			character: 0
		}
	}).trimEnd();
}

function getResolvedNameAndTypeAtPosition(document: TextDocument, position: Position,
	documentData: SourceFileData, activeNamespace: string | undefined): NameAndType | undefined {
	const line = getLineText(document, position.line);
	let i = position.character;
	if ((i >= line.length || !/[a-zA-Z0-9_]/.test(line[i])) && i > 0 && /[a-zA-Z0-9_]/.test(line[i - 1]))
		i--;
	if (i < 0 || i >= line.length || !/[a-zA-Z0-9_]/.test(line[i]))
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
	return getLastNameAndTypeFromCallChain(callChain, documentData, activeNamespace, position.line);
}

function findVisibleVariable(variableName: string, documentData: SourceFileData, lineNumber: number): VariableInfo | undefined {
	const currentVariables = documentData.variables.get(variableName);
	let currentVariable: VariableInfo | undefined = undefined;
	if (currentVariables !== undefined)
		for (const variable of currentVariables)
			if (variable.lineDeclared < lineNumber && (variable.lineUndeclared === undefined ||
				variable.lineUndeclared > lineNumber))
				currentVariable = variable;
	return currentVariable;
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

async function getDefinitionLocationForResolvedName(nameAndType: NameAndType, document: TextDocument,
	documentData: SourceFileData, lineNumber: number): Promise<Location | undefined> {
	const dotPosition = nameAndType.name.indexOf('.');
	if (dotPosition !== -1) {
		const currentClass = classes.get(nameAndType.name.substring(0, dotPosition));
		if (currentClass === undefined)
			return undefined;
		const currentMember = currentClass.members.get(nameAndType.name.substring(dotPosition + 1));
		if (currentMember === undefined)
			return undefined;
		const currentMemberName = currentMember.name.endsWith('()') ?
			currentMember.name.substring(0, currentMember.name.length - 2) : currentMember.name;
		if (currentMember.kind === 'function' && isBuiltInDefinition(currentMember.definition?.uri))
			return undefined;
		const implementationLocation = await getImplementationLocationForClassMember(currentClass, currentMemberName,
			currentMember.kind, currentMember.definition?.uri, currentMember.signature?.label);
		if (implementationLocation !== undefined)
			return implementationLocation;
		return getMemberDefinitionLocation(currentMember.definition);
	}

	const scopeOperatorPosition = nameAndType.name.indexOf('::');
	if (scopeOperatorPosition !== -1) {
		const qualifiedName = nameAndType.name.endsWith('()') ? nameAndType.name.substring(0, nameAndType.name.length - 2) : nameAndType.name;
		const memberName = nameAndType.name.substring(scopeOperatorPosition + 2);
		if (memberName.length !== 0 && /[A-Z]/.test(memberName[0]))
			return getMemberDefinitionLocation(classes.get(qualifiedName)?.definition);

		const currentNamespace = namespaces.get(nameAndType.name.substring(0, scopeOperatorPosition));
		if (currentNamespace === undefined)
			return undefined;
		const currentMember = currentNamespace.members.get(memberName);
		if (currentMember === undefined)
			return undefined;
		if (currentMember.kind === 'function' && isBuiltInDefinition(currentMember.definition?.uri))
			return undefined;
		if (currentMember.kind === 'function') {
			const functionName = currentMember.name.substring(0, currentMember.name.length - 2);
			const implementationLocation = await getImplementationLocationForNamespaceFunction(
				nameAndType.name.substring(0, scopeOperatorPosition), functionName, currentMember.definition?.uri);
			if (implementationLocation !== undefined)
				return implementationLocation;
		}
		return getMemberDefinitionLocation(currentMember.definition);
	}

	if (nameAndType.name.length !== 0 && /[A-Z]/.test(nameAndType.name[0])) {
		const className = nameAndType.name.endsWith('()') ? nameAndType.name.substring(0, nameAndType.name.length - 2) : nameAndType.name;
		const currentClass = classes.get(className);
		if (currentClass === undefined)
			return undefined;
		return getMemberDefinitionLocation(currentClass.definition);
	}

	const currentVariable = findVisibleVariable(nameAndType.name, documentData, lineNumber);
	if (currentVariable === undefined)
		return undefined;
	if (currentVariable.lineDeclared >= 0) {
		const lineText = getLineText(document, currentVariable.lineDeclared);
		const character = lineText.indexOf(currentVariable.name);
		return createLocation(document.uri, currentVariable.lineDeclared, character === -1 ? 0 : character);
	}
	if (currentVariable.name === 'this')
		return getMemberDefinitionLocation(classes.get(currentVariable.type)?.definition);
	return undefined;
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
			},
			end: {
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
			if (scopeOperatorPosition !== -1 && scopeOperatorPosition < name.length - 2 &&
				/[a-z]/.test(name[scopeOperatorPosition + 2])) {
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
			} else if (dotPosition !== -1) {
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
			} else {
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
		const nameAndType = getResolvedNameAndTypeAtPosition(document, textDocumentPosition.position, documentData, activeNamespace);
		if (nameAndType === undefined)
			return undefined;

		let documentation: string | undefined = undefined;
		let isBuiltIn = false;

		const dotPosition = nameAndType.name.indexOf('.');
		const scopeOperatorPosition = nameAndType.name.indexOf('::');
		if (dotPosition !== -1) {
			const currentClass = classes.get(nameAndType.name.substring(0, dotPosition));
			if (currentClass === undefined)
				return undefined;
			const currentMember = currentClass.members.get(nameAndType.name.substring(dotPosition + 1));
			if (currentMember !== undefined) {
				documentation = currentMember.documentation;
				isBuiltIn = currentMember.kind === 'function' && isBuiltInDefinition(currentMember.definition?.uri);
			}
		} else if (scopeOperatorPosition !== -1) {
			const currentNamespace = namespaces.get(nameAndType.name.substring(0, scopeOperatorPosition));
			if (currentNamespace === undefined)
				return undefined;
			const currentMember = currentNamespace.members.get(nameAndType.name.substring(scopeOperatorPosition + 2));
			if (currentMember !== undefined) {
				documentation = currentMember.documentation;
				isBuiltIn = currentMember.kind === 'function' && isBuiltInDefinition(currentMember.definition?.uri);
			}
		}

		return {
			contents: {
				kind: MarkupKind.Markdown,
				value: [
					'```msc',
					(nameAndType.type !== 'Void' ? nameAndType.type + ' ' : '') + nameAndType.name + (isBuiltIn ? ' (builtin)' : ''),
					'```'
				].join('\n') + (documentation === undefined ? '' : '\n' + documentation)
			}
		};
	}
);

connection.onDefinition(
	async (textDocumentPosition: DefinitionParams): Promise<Definition | undefined> => {
		const documentData = await getDocumentData(textDocumentPosition.textDocument.uri);
		const activeNamespace = findActiveNamespace(documentData.usingDeclarations, textDocumentPosition.position.line);

		const document = documents.get(textDocumentPosition.textDocument.uri);
		if (document === undefined)
			return undefined;

		const nameAndType = getResolvedNameAndTypeAtPosition(document, textDocumentPosition.position, documentData, activeNamespace);
		if (nameAndType === undefined)
			return undefined;

		return await getDefinitionLocationForResolvedName(nameAndType, document, documentData, textDocumentPosition.position.line);
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
			},
			end: {
				line: textDocumentPosition.position.line,
				character: textDocumentPosition.position.character
			}
		});
		const usingSuggestionRegExp = /^\s*@using\s+[a-zA-Z0-9_]*$/;
		if (usingSuggestionRegExp.test(line)) {
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
		const commandPrefixes = ['@bypass \\/', '@command \\/', '@console \\/'];
		const commandSuggestionRegExp = new RegExp(`^\\s*(${commandPrefixes.join('|')})[a-z]*$`);
		const commandSuggestionRegExpRes = commandSuggestionRegExp.exec(line);
		if (commandSuggestionRegExpRes !== null) {
			return minecraftCommands;
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
					if (variable.lineDeclared < textDocumentPosition.position.line &&
						(variable.lineUndeclared === undefined || variable.lineUndeclared > textDocumentPosition.position.line))
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

interface DefaultNamespacesPayload {
	text: string
	sourceUri: string
}

connection.onNotification('processDefaultNamespaces', (payload: DefaultNamespacesPayload) => {
	defaultNamespacesSourceUri = payload.sourceUri;
	parseNamespaceFile(payload.text, defaultNamespaces, classes, payload.sourceUri);
	defaultNamespaces.forEach((value: NamespaceInfo, key: string) => {
		namespaces.set(key, value);
	});
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

function validateScriptOperatorSyntax(trimmedLine: string, firstWord: string, lineNumber: number, lineStartIndex: number, lineLength: number, diagnostics: Diagnostic[]) {
	if (!validStarters.includes(firstWord)) {
		raise(diagnostics, RULES.SYN003, {
			start: { line: lineNumber, character: lineStartIndex },
			end: { line: lineNumber, character: lineStartIndex + firstWord.length }
		}, { message: `Invalid script option ${firstWord}` });
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

function processControlStatements(firstWord: string, lineNumber: number, lineStartIndex: number, lineLength: number, parsingContext: ScriptParsingContext, diagnostics: Diagnostic[]) {
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
					raise(diagnostics, RULES.SYN017, {
						start: { line: lineNumber, character: lineStartIndex },
						end: { line: lineNumber, character: lineStartIndex + firstWord.length }
					}, { message: `Mismatched ${firstWord}: expected ${lastBlock.type === 'if' ? '@fi' : '@done'}` });
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

	if (trimmedLine === '' || trimmedLine.startsWith("# ") || trimmedLine === "#") {
		return;
	}

	const firstWord = trimmedLine.split(" ")[0];
	const lineStartIndex = line.indexOf(firstWord);

	validateScriptOperatorSyntax(trimmedLine, firstWord, lineNumber, lineStartIndex, line.length, diagnostics);
	processControlStatements(firstWord, lineNumber, lineStartIndex, line.length, parsingContext, diagnostics);
	validateHeaderPosition(firstWord, lineNumber, lineStartIndex, line.length, parsingContext, diagnostics);
}

function validateAndReportDiagnostics(textDocument: TextDocument): void {
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

	for (let i = 0; i < lines.length; i++) {
		processLine(lines[i], i, parsingContext, diagnostics);
	}

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
	const filtered = diagnostics.filter(d => {
		const code = diagnosticCode(d);
		if (code && fileCodes.has(code)) return false;
		const lineSup = suppressions.perLine.get(d.range.start.line);
		if (lineSup === 'any') return false;
		if (lineSup && code && lineSup.has(code)) return false;
		return true;
	});

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
	validateAndReportDiagnostics(change.document);
});

// Register the text document validation function
documents.onDidOpen(change => {
	void refreshDocument(change.document.uri);
	validateAndReportDiagnostics(change.document);
});

documents.onDidChangeContent(e => {
	void refreshDocument(e.document.uri);
	validateAndReportDiagnostics(e.document);
});

documents.onDidClose(e => {
	sourceFileData.delete(e.document.uri);
});

connection.onDidChangeWatchedFiles(_ => {
	refreshNamespaceFiles();
});

// Listen on the connection
connection.listen();
