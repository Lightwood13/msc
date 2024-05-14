import {
	CompletionItem,
	CompletionItemKind,
	InsertTextFormat,
	MarkupKind,
	ParameterInformation,
	SignatureInformation
} from 'vscode-languageserver/node';

export interface VariableInfo {
	name: string
	type: string
	lineDeclared: number
	lineUndeclared: number | undefined
	suggestion: CompletionItem;
}
export interface MemberInfo {
	name: string
	returnType: string
	documentation: string | undefined
	suggestion: CompletionItem | undefined
	signature: SignatureInformation | undefined
}
export interface NamespaceInfo {
	members: Map<string, MemberInfo>
	memberSignatures: Map<string, SignatureInformation[] | undefined>
	memberSuggestions: CompletionItem[]
}
export type ClassInfo = NamespaceInfo;
export interface UsingDeclaration {
	lineDeclared: number
	namespace: string
}
export interface SourceFileData {
	variables: Map<string, VariableInfo[]>
	usingDeclarations: UsingDeclaration[]
}

export const newLineRegExp = /\r?\n/;
export const namespaceSignatureRegExp = /^\s*@namespace\s+([a-zA-Z][a-zA-Z0-9_]*|__default__)\s*$/;
export const classSignatureRegExp = /^\s*@class\s+([A-Z][a-zA-Z0-9_]*)\s*$/;
export const functionSignatureRegExp = /^\s*(?:((?:[a-zA-Z][a-zA-Z0-9_]*::)?[A-Z][a-zA-Z0-9_]*(?:\[\])?)\s+)?([a-z][a-zA-Z0-9_]*)\s*(\(.*\))\s*$/;
export const constructorSignatureRegExp = /^\s*([A-Z][a-zA-Z0-9_]*)\s*(\(.*\))\s*$/;
export const variableSignatureRegExp = /^\s*((relative\s+)?(final\s+)?(relative\s+)?((?:[a-zA-Z][a-zA-Z0-9_]*::)?[A-Z][a-zA-Z0-9_]*(?:\[\])?)\s+([a-z][a-zA-Z0-9_]*))\s*(=.*)?$/;
const commentRegExp = /^\s*#\s*(.*)\s*$/;
const allowedTypeNameWithNamespaceRegExp = /^([a-zA-Z][a-zA-Z0-9_]*::)?[A-Z][a-zA-Z0-9_]*(\[\])?$/;
const allowedNameRegExp = /^[a-z][a-zA-Z0-9_]*$/;
const firstLineCommentRegExp = /^\s*#(?:.*\()?(\s*,?\s*([a-zA-Z][a-zA-Z0-9_]*::)?[A-Z][a-zA-Z0-9_]*(\[\])?\s+[a-z][a-zA-Z0-9_]*)+(?:\s*\))?\s*$/;


export function parseNamespaceFile(text: string, namespaceStorage: Map<string, NamespaceInfo>,
	classStorage: Map<string, ClassInfo>) {
	const lines = text.split(newLineRegExp);
	for (let i = 0; i < lines.length; i++) {
		const regExpRes = namespaceSignatureRegExp.exec(lines[i]);
		if (regExpRes === null)
			continue;
		let j = i;
		for (j = i; j < lines.length; j++) {
			if (lines[j].trim() === '@endnamespace')
				break;
		}
		if (j === lines.length)
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
			if (newMember === null)
				continue;

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

			continue;
		}

		const description = parseCommentsAboveLine(lines, i);

		let j = i;
		for (j = i; j < lines.length; j++) {
			if (lines[j].trim() === '@endclass')
				break;
		}
		if (j === lines.length)
			break;

		const className = classRegExpRes[1];
		let classNameWithNamespace = className;
		if (name !== '__default__')
			classNameWithNamespace = name + '::' + className;
		classStorage.set(classNameWithNamespace, parseClass(classNameWithNamespace, lines.slice(i + 1, j)));
		classStorage.set(classNameWithNamespace + '[]', parseClass(classNameWithNamespace + '[]', getArrayClassDefinition(classNameWithNamespace)));
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
		result.name = variableRegExpRes[6];
		result.returnType = variableRegExpRes[5];
		result.suggestion = {
			label: variableRegExpRes[6],
			kind: CompletionItemKind.Variable,
			detail: lines[line].replace(variableSignatureRegExp,
				((variableRegExpRes[3] !== undefined) ? 'final ' : '')
				+ ((variableRegExpRes[2] !== undefined || variableRegExpRes[4] !== undefined) ? 'relative ' : '')
				+ '$4 ' + namePrefix + '$5')
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
			result.signature.documentation = {
				kind: MarkupKind.Markdown,
				value: description
			};
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

// eslint-disable-next-line require-await
export async function parseDocument(text: string): Promise<SourceFileData> {
	const result: SourceFileData = 
	{
		variables: new Map(),
		usingDeclarations: [],
	};

	result.variables.set('player', [{
		name: 'player',
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
		name: 'block',
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
				name: regExpRes[2],
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
	const variableStack: VariableInfo[][] = [];
	for (let i = 0; i < lines.length; i++) {
		const tokens = lines[i].trim().split(/\s+/);
		if (tokens.length === 0)
			continue;
		if (tokens[0] === '@if') {
			variableStack.push([]);
		}
		else if (tokens.length >= 3 && tokens[0] === '@for') {
			variableStack.push([]);
			if (!allowedTypeNameWithNamespaceRegExp.test(tokens[1]) || !allowedNameRegExp.test(tokens[2]))
				continue;
			variableStack[variableStack.length - 1].push({
				name: tokens[2],
				lineDeclared: i,
				lineUndeclared: undefined,
				type: tokens[1],
				suggestion: {
					label: tokens[2],
					kind: CompletionItemKind.Variable,
					detail: tokens[1] + ' ' + tokens[2]
				}
			});
		}
		else if (tokens[0] === '@fi' || tokens[0] === '@else' || tokens[0] === '@elseif' || tokens[0] === '@done') {
			const lastBlockVariables = variableStack.pop();
			if (lastBlockVariables === undefined)
				break;
			for (const variable of lastBlockVariables) {
				variable.lineUndeclared = i;
				let sameNameVariables = result.variables.get(variable.name);
				if (sameNameVariables === undefined)
					sameNameVariables = [];
				sameNameVariables.push(variable);
				result.variables.set(variable.name, sameNameVariables);
			}
			if (tokens[0] === '@else' || tokens[0] === '@elseif') {
				variableStack.push([]);
			}
		}

		if (tokens.length >= 3 && tokens[0] === '@define') {
			if (tokens[2].endsWith('='))
				tokens[2] = tokens[2].substring(0, tokens[2].length - 1);

			const newVariableInfo: VariableInfo = {
				name: tokens[2],
				lineDeclared: i,
				lineUndeclared: undefined,
				type: tokens[1],
				suggestion: {
					label: tokens[2],
					kind: CompletionItemKind.Variable,
					detail: tokens[1] + ' ' + tokens[2]
				}
			};
			
			if (variableStack.length > 0) {
				variableStack[variableStack.length - 1].push(newVariableInfo);
			}
			else {
				let sameNameVariables = result.variables.get(newVariableInfo.name);
				if (sameNameVariables === undefined)
					sameNameVariables = [];
				sameNameVariables.push(newVariableInfo);
				result.variables.set(newVariableInfo.name, sameNameVariables);
			}
		}
		else if (tokens.length === 2 && tokens[0] === '@using')
			result.usingDeclarations.push({
				lineDeclared: i,
				namespace: tokens[1]
			});
	}
	return result;
}