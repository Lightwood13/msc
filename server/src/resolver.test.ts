import * as assert from 'assert';
import { CompletionItemKind, SignatureInformation } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { ClassInfo, DefinitionLocation, MemberInfo, NamespaceInfo } from './parser';
import { resolveDocument } from './resolver';

function createDefinition(uri: string, line: number, character: number): DefinitionLocation {
	return { uri, line, character };
}

function createMember(name: string, kind: 'variable' | 'function' | 'constructor', returnType: string, uri: string): MemberInfo {
	const label = kind === 'function' || kind === 'constructor' ? `${returnType === 'Void' ? '' : `${returnType} `}${name}` : `${returnType} ${name}`;
	return {
		name,
		kind,
		returnType,
		documentation: `${name} docs`,
		suggestion: {
			label: name.replace(/\(\)$/, ''),
			kind: kind === 'variable' ? CompletionItemKind.Variable : CompletionItemKind.Method,
			detail: label
		},
		signature: kind === 'function' || kind === 'constructor' ? SignatureInformation.create(label, undefined) : undefined,
		definition: createDefinition(uri, 0, 0)
	};
}

function createNamespace(members: MemberInfo[]): NamespaceInfo {
	const memberMap = new Map<string, MemberInfo>();
	const memberSignatures = new Map<string, SignatureInformation[] | undefined>();
	const memberSuggestions = [];

	for (const member of members) {
		memberMap.set(member.name, member);
		memberSuggestions.push(member.suggestion!);
		if (member.signature !== undefined) {
			memberSignatures.set(member.name, [member.signature]);
		}
	}

	return {
		members: memberMap,
		memberSignatures,
		memberSuggestions
	};
}

function createClass(name: string, namespaceName: string, members: MemberInfo[]): ClassInfo {
	const namespace = createNamespace(members);
	return {
		...namespace,
		className: name.includes('::') ? name.substring(name.indexOf('::') + 2) : name,
		namespaceName,
		definition: createDefinition(`file://${name}.nms`, 0, 0)
	};
}

function createDocument(text: string): TextDocument {
	return TextDocument.create('file:///test.msc', 'msc', 1, text);
}

function positionOf(document: TextDocument, needle: string, occurrence = 0) {
	const text = document.getText();
	let index = -1;
	let from = 0;
	for (let i = 0; i <= occurrence; i++) {
		index = text.indexOf(needle, from);
		if (index === -1) throw new Error(`Could not find ${needle}`);
		from = index + needle.length;
	}
	const prefix = text.slice(0, index);
	const lines = prefix.split('\n');
	return {
		line: lines.length - 1,
		character: lines[lines.length - 1].length
	};
}

describe('MSC resolver', () => {
	const widgetUri = 'file:///widget.nms';
	const toolsUri = 'file:///tools.nms';
	const transmuteUri = 'file:///transmute.nms';
	const stringUri = 'file:///string.nms';
	const playerUri = 'file:///player.nms';
	const widgetClass = createClass('Widget', '__default__', [
		createMember('name', 'variable', 'String', widgetUri),
		createMember('size()', 'function', 'Int', widgetUri)
	]);
	const playerClass = createClass('Player', '__default__', [
		createMember('name', 'variable', 'String', playerUri),
		createMember('size()', 'function', 'Int', playerUri)
	]);
	const toolsWidgetClass = createClass('tools::Widget', 'tools', [
		createMember('label', 'variable', 'String', toolsUri),
		createMember('size()', 'function', 'Int', toolsUri)
	]);
	const transmuteMachineClass = createClass('transmute::Machine', 'transmute', [
		createMember('state', 'variable', 'String', transmuteUri),
		createMember('run()', 'function', 'Void', transmuteUri)
	]);
	const stringClass = createClass('String', '__default__', [
		createMember('length()', 'function', 'Int', stringUri)
	]);
	const namespaces = new Map<string, NamespaceInfo>([
		['__default__', createNamespace([])],
		['tools', createNamespace([
			createMember('makeWidget()', 'function', 'tools::Widget', toolsUri),
			createMember('widget', 'variable', 'tools::Widget', toolsUri),
			createMember('count', 'variable', 'Int', toolsUri)
		])],
		['transmute', createNamespace([
			createMember('machine10a', 'variable', 'Machine', transmuteUri)
		])]
	]);
	const classes = new Map<string, ClassInfo>([
		['Player', playerClass],
		['String', stringClass],
		['Widget', widgetClass],
		['tools::Widget', toolsWidgetClass],
		['transmute::Machine', transmuteMachineClass]
	]);

	it('resolves local declarations and references', () => {
		const document = createDocument('@define Int count = 1\n@return count');
		const resolution = resolveDocument({ document, namespaces, classes });
		const declaration = resolution.getReferenceAtPosition(positionOf(document, 'count'));
		const reference = resolution.getReferenceAtPosition(positionOf(document, 'count', 1));

		assert.ok(declaration);
		assert.ok(reference);
		assert.strictEqual(declaration!.isDeclaration, true);
		assert.strictEqual(reference!.symbol.kind, 'localVariable');
		assert.strictEqual(reference!.symbol.definition?.line, 0);
	});

	it('resolves first-line parameter comment variables', () => {
		const document = createDocument('#(Int age)\n@return age');
		const resolution = resolveDocument({ document, namespaces, classes });
		const reference = resolution.getReferenceAtPosition(positionOf(document, 'age', 1));

		assert.ok(reference);
		assert.strictEqual(reference!.symbol.kind, 'localVariable');
		assert.strictEqual(reference!.symbol.definition?.line, 0);
	});

	it('handles shadowing inside nested blocks', () => {
		const document = createDocument('@define Int count = 1\n@if ready\n@define Int count = 2\n@return count\n@fi');
		const resolution = resolveDocument({ document, namespaces, classes });
		const reference = resolution.getReferenceAtPosition(positionOf(document, 'count', 2));

		assert.ok(reference);
		assert.strictEqual(reference!.symbol.definition?.line, 2);
	});

	it('resolves implicit this and chained members', () => {
		const document = createDocument('@return this.name');
		const resolution = resolveDocument({
			document,
			namespaces,
			classes,
			implicitVariables: [{ name: 'this', type: 'Widget' }]
		});

		const thisRef = resolution.getReferenceAtPosition(positionOf(document, 'this'));
		const memberRef = resolution.getReferenceAtPosition(positionOf(document, 'name'));

		assert.ok(thisRef);
		assert.ok(memberRef);
		assert.strictEqual(thisRef!.symbol.kind, 'localVariable');
		assert.strictEqual(memberRef!.symbol.kind, 'instanceField');
	});

	it('resolves active namespaces and explicit namespace-qualified lookups', () => {
		const document = createDocument('@using tools\n@return makeWidget()');
		const resolution = resolveDocument({ document, namespaces, classes });
		const activeRef = resolution.getReferenceAtPosition(positionOf(document, 'makeWidget'));

		assert.ok(activeRef);
		assert.strictEqual(activeRef!.symbol.kind, 'namespaceFunction');
		assert.strictEqual(activeRef!.symbol.name, 'tools::makeWidget()');

		const explicitDocument = createDocument('@return tools::count');
		const explicitResolution = resolveDocument({ document: explicitDocument, namespaces, classes });
		const explicitRef = explicitResolution.getReferenceAtPosition(positionOf(explicitDocument, 'count'));

		assert.ok(explicitRef);
		assert.strictEqual(explicitRef!.symbol.kind, 'namespaceVariable');
		assert.strictEqual(explicitRef!.symbol.name, 'tools::count');
	});

	it('provides completion contexts for member access and namespace members', () => {
		const memberDocument = createDocument('@using tools\n@return makeWidget().');
		const memberResolution = resolveDocument({ document: memberDocument, namespaces, classes });
		const memberContext = memberResolution.getCompletionContext(positionOf(memberDocument, '.').line === 1
			? { line: 1, character: memberDocument.getText().split('\n')[1].length }
			: { line: 0, character: 0 });

		assert.strictEqual(memberContext.kind, 'member');
		assert.strictEqual(memberContext.hostType, 'tools::Widget');

		const namespaceDocument = createDocument('@return tools::');
		const namespaceResolution = resolveDocument({ document: namespaceDocument, namespaces, classes });
		const namespaceContext = namespaceResolution.getCompletionContext({ line: 0, character: '@return tools::'.length });

		assert.strictEqual(namespaceContext.kind, 'namespaceMembers');
		assert.strictEqual(namespaceContext.namespaceName, 'tools');

		const activeNamespaceTypeDocument = createDocument('@using transmute\n@define Machine m2\n@var m2.');
		const activeNamespaceTypeResolution = resolveDocument({
			document: activeNamespaceTypeDocument,
			namespaces,
			classes
		});
		const activeNamespaceTypeContext = activeNamespaceTypeResolution.getCompletionContext({
			line: 2,
			character: '@var m2.'.length
		});
		assert.strictEqual(activeNamespaceTypeContext.kind, 'member');
		assert.strictEqual(activeNamespaceTypeContext.hostType, 'transmute::Machine');
	});

	it('treats a completed variable token as a member-completion host', () => {
		const document = createDocument('@return player');
		const resolution = resolveDocument({ document, namespaces, classes });
		const context = resolution.getCompletionContext({ line: 0, character: '@return player'.length });

		assert.strictEqual(context.kind, 'member');
		assert.strictEqual(context.hostType, 'Player');
	});

	it('treats completed namespace-qualified values and types as member-completion hosts', () => {
		const namespaceVariableDocument = createDocument('@return tools::widget');
		const namespaceVariableResolution = resolveDocument({ document: namespaceVariableDocument, namespaces, classes });
		const namespaceVariableContext = namespaceVariableResolution.getCompletionContext({
			line: 0,
			character: '@return tools::widget'.length
		});
		assert.strictEqual(namespaceVariableContext.kind, 'member');
		assert.strictEqual(namespaceVariableContext.hostType, 'tools::Widget');

		const namespaceFunctionDocument = createDocument('@return tools::makeWidget().');
		const namespaceFunctionResolution = resolveDocument({ document: namespaceFunctionDocument, namespaces, classes });
		const namespaceFunctionContext = namespaceFunctionResolution.getCompletionContext({
			line: 0,
			character: '@return tools::makeWidget().'.length
		});
		assert.strictEqual(namespaceFunctionContext.kind, 'member');
		assert.strictEqual(namespaceFunctionContext.hostType, 'tools::Widget');

		const bareTypeDocument = createDocument('@return Widget');
		const bareTypeResolution = resolveDocument({ document: bareTypeDocument, namespaces, classes });
		const bareTypeContext = bareTypeResolution.getCompletionContext({
			line: 0,
			character: '@return Widget'.length
		});
		assert.strictEqual(bareTypeContext.kind, 'member');
		assert.strictEqual(bareTypeContext.hostType, 'Widget');

		const namespacedTypeDocument = createDocument('@return tools::Widget');
		const namespacedTypeResolution = resolveDocument({ document: namespacedTypeDocument, namespaces, classes });
		const namespacedTypeContext = namespacedTypeResolution.getCompletionContext({
			line: 0,
			character: '@return tools::Widget'.length
		});
		assert.strictEqual(namespacedTypeContext.kind, 'member');
		assert.strictEqual(namespacedTypeContext.hostType, 'tools::Widget');

		const unqualifiedNamespaceTypeDocument = createDocument('@return transmute::machine10a');
		const unqualifiedNamespaceTypeResolution = resolveDocument({
			document: unqualifiedNamespaceTypeDocument,
			namespaces,
			classes
		});
		const unqualifiedNamespaceTypeContext = unqualifiedNamespaceTypeResolution.getCompletionContext({
			line: 0,
			character: '@return transmute::machine10a'.length
		});
		assert.strictEqual(unqualifiedNamespaceTypeContext.kind, 'member');
		assert.strictEqual(unqualifiedNamespaceTypeContext.hostType, 'transmute::Machine');
	});

	it('suppresses completion in inert text but restores it inside interpolation', () => {
		const commandDocument = createDocument('@command /give player diamond 1');
		const commandResolution = resolveDocument({ document: commandDocument, namespaces, classes });
		assert.strictEqual(
			commandResolution.getCompletionContext({ line: 0, character: '@command /give player'.length }).kind,
			'none'
		);

		const stringDocument = createDocument('@define String output = "player"');
		const stringResolution = resolveDocument({ document: stringDocument, namespaces, classes });
		assert.strictEqual(
			stringResolution.getCompletionContext({ line: 0, character: '@define String output = "player'.length }).kind,
			'none'
		);

		const interpolationDocument = createDocument('@command /give {{player}} diamond 1');
		const interpolationResolution = resolveDocument({ document: interpolationDocument, namespaces, classes });
		const interpolationContext = interpolationResolution.getCompletionContext({
			line: 0,
			character: '@command /give {{player'.length
		});
		assert.strictEqual(interpolationContext.kind, 'member');
		assert.strictEqual(interpolationContext.hostType, 'Player');

		const nestedStringDocument = createDocument('@command /give {{"player"}} diamond 1');
		const nestedStringResolution = resolveDocument({ document: nestedStringDocument, namespaces, classes });
		assert.strictEqual(
			nestedStringResolution.getCompletionContext({
				line: 0,
				character: '@command /give {{"player'.length
			}).kind,
			'none'
		);
	});

	it('resolves operator expressions for member completion', () => {
		const document = createDocument('@return ("a" + player).');
		const resolution = resolveDocument({ document, namespaces, classes });
		const context = resolution.getCompletionContext({
			line: 0,
			character: '@return ("a" + player).'.length
		});

		assert.strictEqual(context.kind, 'member');
		assert.strictEqual(context.hostType, 'String');
	});

	it('reports invalid operator combinations in expression analysis', () => {
		const document = createDocument('@return true + false');
		const resolution = resolveDocument({ document, namespaces, classes });
		const analysis = resolution.analyzeExpression('true + false', 0, '@return '.length);

		assert.strictEqual(analysis.type, undefined);
		assert.strictEqual(analysis.diagnostics.length, 1);
		assert.match(analysis.diagnostics[0].message, /Operator '\+' is not applicable on types: Boolean, Boolean/);
		assert.strictEqual(analysis.diagnostics[0].range.start.character, '@return true '.length);
	});

	it('resolves call contexts for chained calls', () => {
		const document = createDocument('@using tools\n@return makeWidget().size(');
		const resolution = resolveDocument({ document, namespaces, classes });
		const callContext = resolution.getCallContext({ line: 1, character: '@return makeWidget().size('.length });

		assert.ok(callContext);
		assert.strictEqual(callContext!.symbol.kind, 'instanceMethod');
		assert.strictEqual(callContext!.symbol.name, 'tools::Widget.size()');
	});

	it('only provides call context in resolvable code', () => {
		const commandDocument = createDocument('@command /say size(');
		const commandResolution = resolveDocument({ document: commandDocument, namespaces, classes });
		assert.strictEqual(commandResolution.getCallContext({ line: 0, character: '@command /say size('.length }), undefined);

		const interpolationDocument = createDocument('@command /say {{player.size(}}');
		const interpolationResolution = resolveDocument({
			document: interpolationDocument,
			namespaces,
			classes
		});
		const callContext = interpolationResolution.getCallContext({
			line: 0,
			character: '@command /say {{player.size('.length
		});
		assert.ok(callContext);
		assert.strictEqual(callContext!.symbol.kind, 'instanceMethod');
	});

	it('only resolves interpolation inside command payloads and strings', () => {
		const commandDocument = createDocument('@command /give {{player}} diamond 1');
		const commandResolution = resolveDocument({ document: commandDocument, namespaces, classes });
		assert.strictEqual(commandResolution.getReferenceAtPosition(positionOf(commandDocument, 'give')), undefined);
		assert.strictEqual(commandResolution.getReferenceAtPosition(positionOf(commandDocument, 'player'))?.symbol.kind, 'builtinVariable');

		const stringDocument = createDocument('@define Int age = 5\n@define String output = "I am {{age}} years old."');
		const stringResolution = resolveDocument({ document: stringDocument, namespaces, classes });
		assert.strictEqual(stringResolution.getReferenceAtPosition(positionOf(stringDocument, 'years')), undefined);
		assert.strictEqual(stringResolution.getReferenceAtPosition(positionOf(stringDocument, 'age', 1))?.symbol.kind, 'localVariable');
	});

	it('produces unresolved references for unknown identifiers', () => {
		const document = createDocument('@return mystery');
		const resolution = resolveDocument({ document, namespaces, classes });
		const reference = resolution.getReferenceAtPosition(positionOf(document, 'mystery'));

		assert.ok(reference);
		assert.strictEqual(reference!.symbol.kind, 'unresolved');
	});
});
