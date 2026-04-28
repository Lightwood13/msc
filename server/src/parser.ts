import {
	CompletionItem,
	CompletionItemKind,
	InsertTextFormat,
	MarkupKind,
	ParameterInformation,
	SignatureInformation
} from 'vscode-languageserver/node';

export interface DefinitionLocation {
	uri: string
	line: number
	character: number
}
export type MemberKind = 'variable' | 'function' | 'constructor';
export interface MemberInfo {
	name: string
	kind: MemberKind
	returnType: string
	documentation: string | undefined
	suggestion: CompletionItem | undefined
	signature: SignatureInformation | undefined
	definition: DefinitionLocation | undefined
	isFinal: boolean
}
export interface NamespaceInfo {
	members: Map<string, MemberInfo>
	memberSignatures: Map<string, SignatureInformation[] | undefined>
	memberSuggestions: CompletionItem[]
}
export interface ClassInfo extends NamespaceInfo {
	className: string
	namespaceName: string
	definition: DefinitionLocation
}
export const newLineRegExp = /\r?\n/;
export const namespaceSignatureRegExp = /^\s*@namespace\s+([a-zA-Z][a-zA-Z0-9_]*|__default__)\s*$/;
export const classSignatureRegExp = /^\s*@class\s+([A-Z][a-zA-Z0-9_]*)\s*$/;
export const functionSignatureRegExp = /^\s*(?:((?:[a-zA-Z][a-zA-Z0-9_]*::)?[A-Z][a-zA-Z0-9_]*(?:\[\])?)\s+)?([a-z][a-zA-Z0-9_]*)\s*(\(.*\))\s*$/;
export const constructorSignatureRegExp = /^\s*([A-Z][a-zA-Z0-9_]*)\s*(\(.*\))\s*$/;
export const variableSignatureRegExp = /^\s*((relative\s+)?(final\s+)?(relative\s+)?((?:[a-zA-Z][a-zA-Z0-9_]*::)?[A-Z][a-zA-Z0-9_]*(?:\[\])?)\s+([a-z][a-zA-Z0-9_]*))\s*(=.*)?$/;
const commentRegExp = /^\s*#\s*(.*)\s*$/;


export function parseNamespaceFile(text: string, namespaceStorage: Map<string, NamespaceInfo>,
	classStorage: Map<string, ClassInfo>, sourceUri: string) {
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
		namespaceStorage.set(regExpRes[1], parseNamespace(regExpRes[1], lines.slice(i + 1, j), classStorage, sourceUri, i + 1));
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

function parseNamespace(name: string, lines: string[], classStorage: Map<string, ClassInfo>,
	sourceUri: string, lineOffset: number): NamespaceInfo {
	const result: NamespaceInfo = {
		members: new Map(),
		memberSignatures: new Map(),
		memberSuggestions: []
	};
	for (let i = 0; i < lines.length; i++) {
		const classRegExpRes = classSignatureRegExp.exec(lines[i]);
		if (classRegExpRes === null) {
			const newMember = parseVariableOrFunctionAtLine(name + '::', lines, i, sourceUri, lineOffset);
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
		const classDefinition: DefinitionLocation = {
			uri: sourceUri,
			line: lineOffset + i,
			character: lines[i].indexOf(className)
		};
		classStorage.set(classNameWithNamespace, parseClass(classNameWithNamespace, lines.slice(i + 1, j),
			sourceUri, lineOffset + i + 1, name, className, classDefinition));
		classStorage.set(classNameWithNamespace + '[]', parseClass(classNameWithNamespace + '[]',
			getArrayClassDefinition(classNameWithNamespace), undefined, 0, name, className + '[]', classDefinition));
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

function parseClass(classNameWithNamespace: string, lines: string[], sourceUri: string | undefined, lineOffset: number,
	namespaceName: string, className: string, definition: DefinitionLocation): ClassInfo {
	const result: ClassInfo = {
		members: new Map(),
		memberSignatures: new Map(),
		memberSuggestions: [],
		className: className,
		namespaceName: namespaceName,
		definition: definition
	};
	for (let i = 0; i < lines.length; i++) {
		const newMember = parseVariableOrFunctionAtLine(classNameWithNamespace + '.', lines, i, sourceUri, lineOffset);
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

function parseVariableOrFunctionAtLine(namePrefix: string, lines: string[], line: number,
	sourceUri: string | undefined, lineOffset: number): MemberInfo | null {
	const functionRegExpRes = functionSignatureRegExp.exec(lines[line]);
	const constructorRegExpRes = constructorSignatureRegExp.exec(lines[line]);
	const variableRegExpRes = variableSignatureRegExp.exec(lines[line]);
	if (functionRegExpRes === null && constructorRegExpRes === null && variableRegExpRes === null)
		return null;
	const description = parseCommentsAboveLine(lines, line);

	const result: MemberInfo = {
		returnType: '',
		name: '',
		kind: 'variable',
		suggestion:  {
			label: 'label'
		},
		signature: undefined,
		documentation: undefined,
		definition: undefined,
		isFinal: false
	};

	if (functionRegExpRes !== null) {
		result.name = functionRegExpRes[2] + '()';
		result.kind = 'function';
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
		if (sourceUri !== undefined)
			result.definition = {
				uri: sourceUri,
				line: lineOffset + line,
				character: lines[line].indexOf(functionRegExpRes[2])
			};
		if (result.suggestion.detail !== undefined)
			result.signature = {
				label: result.suggestion.detail,
				parameters: getParamsFromSignature(result.suggestion.detail)
			};
	}
	else if (constructorRegExpRes !== null) {
		result.name = constructorRegExpRes[1] + '()';
		result.kind = 'constructor';
		result.returnType = constructorRegExpRes[1];
		result.suggestion = undefined;
		const temp = lines[line].replace(constructorSignatureRegExp, '$1$2');
		if (sourceUri !== undefined)
			result.definition = {
				uri: sourceUri,
				line: lineOffset + line,
				character: lines[line].indexOf(constructorRegExpRes[1])
			};
		result.signature = {
			label: temp,
			parameters: getParamsFromSignature(temp)
		};
	}
	else if (variableRegExpRes !== null) {
		result.name = variableRegExpRes[6];
		result.kind = 'variable';
		result.returnType = variableRegExpRes[5];
		result.isFinal = variableRegExpRes[3] !== undefined;
		result.suggestion = {
			label: variableRegExpRes[6],
			kind: CompletionItemKind.Variable,
			detail: lines[line].replace(variableSignatureRegExp,
				((variableRegExpRes[3] !== undefined) ? 'final ' : '')
					+ ((variableRegExpRes[2] !== undefined || variableRegExpRes[4] !== undefined) ? 'relative ' : '')
					+ '$4 ' + namePrefix + '$5')
			};
		if (sourceUri !== undefined)
			result.definition = {
				uri: sourceUri,
				line: lineOffset + line,
				character: lines[line].indexOf(variableRegExpRes[6])
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
