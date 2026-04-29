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
		definition: createDefinition(uri, 0, 0),
		isFinal: false
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
		createMember('length()', 'function', 'Int', stringUri),
		createMember('contains()', 'function', 'Boolean', stringUri)
	]);
	const namespaces = new Map<string, NamespaceInfo>([
		['__default__', createNamespace([])],
		['tools', createNamespace([
			createMember('makeWidget()', 'function', 'tools::Widget', toolsUri),
			createMember('widget', 'variable', 'tools::Widget', toolsUri),
			createMember('count', 'variable', 'Int', toolsUri)
		])],
		['transmute', createNamespace([
			createMember('machine10a', 'variable', 'Machine', transmuteUri),
			createMember('machines', 'variable', 'Machine[]', transmuteUri)
		])]
	]);
	const transmuteMachineArrayClass = createClass('transmute::Machine[]', 'transmute', [
		createMember('length()', 'function', 'Int', transmuteUri)
	]);
	const classes = new Map<string, ClassInfo>([
		['Player', playerClass],
		['String', stringClass],
		['Widget', widgetClass],
		['tools::Widget', toolsWidgetClass],
		['transmute::Machine', transmuteMachineClass],
		['transmute::Machine[]', transmuteMachineArrayClass]
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

	it('widens numeric arithmetic to the wider operand type', () => {
		const document = createDocument('@define Int i\n@define Long l\n@define Float f\n@define Double d\n');
		const resolution = resolveDocument({ document, namespaces, classes });

		assert.strictEqual(resolution.analyzeExpression('i + l', 4, 0).type, 'Long');
		assert.strictEqual(resolution.analyzeExpression('l + i', 4, 0).type, 'Long');
		assert.strictEqual(resolution.analyzeExpression('l + f', 4, 0).type, 'Float');
		assert.strictEqual(resolution.analyzeExpression('f + d', 4, 0).type, 'Double');
		assert.strictEqual(resolution.analyzeExpression('i ^ i', 4, 0).type, 'Double');
	});

	it('respects vector and block-vector scalar overloads', () => {
		const document = createDocument('@define Vector3 v3\n@define BlockVector3 bv3\n');
		const resolution = resolveDocument({ document, namespaces, classes });

		assert.strictEqual(resolution.analyzeExpression('v3 * 2.0d', 2, 0).type, 'Vector3');
		assert.strictEqual(resolution.analyzeExpression('v3 + v3', 2, 0).type, 'Vector3');
		assert.strictEqual(resolution.analyzeExpression('v3 * 2', 2, 0).diagnostics.length, 1);

		assert.strictEqual(resolution.analyzeExpression('bv3 * 2', 2, 0).type, 'BlockVector3');
		assert.strictEqual(resolution.analyzeExpression('bv3 + bv3', 2, 0).type, 'BlockVector3');
		assert.strictEqual(resolution.analyzeExpression('bv3 * 2.0d', 2, 0).diagnostics.length, 1);
	});

	it('handles location subtraction and rejects spatial string concatenation', () => {
		const document = createDocument('@define Location loc\n@define BlockLocation bloc\n@define Player p\n');
		const resolution = resolveDocument({ document, namespaces, classes });

		assert.strictEqual(resolution.analyzeExpression('loc - loc', 3, 0).type, 'Vector3');
		assert.strictEqual(resolution.analyzeExpression('bloc - bloc', 3, 0).type, 'BlockVector3');
		assert.strictEqual(resolution.analyzeExpression('p + "x"', 3, 0).type, 'String');
		assert.strictEqual(resolution.analyzeExpression('loc + "x"', 3, 0).diagnostics.length, 1);
	});

	it('does not report a postfix-dot semantic error after parenthesized expressions', () => {
		const document = createDocument('@return ("a" + 1).contains("a")');
		const resolution = resolveDocument({ document, namespaces, classes });
		const analysis = resolution.analyzeExpression('("a" + 1).contains("a")', 0, '@return '.length);

		assert.strictEqual(analysis.diagnostics.length, 0);
		assert.strictEqual(analysis.type, 'Boolean');
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
		assert.strictEqual(reference!.token.kind, 'identifier');
	});

	it('classifies @using namespace tokens at the namespace name only', () => {
		const document = createDocument('@using unknownNs');
		const resolution = resolveDocument({ document, namespaces, classes });
		const tokensOnLine = resolution.tokens.filter(t => t.line === 0);

		const namespaceToken = tokensOnLine.find(t => t.kind === 'namespaceName');
		assert.ok(namespaceToken);
		assert.strictEqual(namespaceToken!.text, 'unknownNs');
		assert.strictEqual(tokensOnLine.some(t => t.kind === 'identifier' && t.text === 'unknownNs'), false);
	});

	it('reports namespace presence via hasNamespace', () => {
		const document = createDocument('@using tools');
		const resolution = resolveDocument({ document, namespaces, classes });

		assert.strictEqual(resolution.hasNamespace('tools'), true);
		assert.strictEqual(resolution.hasNamespace('__default__'), true);
		assert.strictEqual(resolution.hasNamespace('mystery'), false);
	});

	it('exposes the namespace qualifier preceding a member token', () => {
		const known = createDocument('@return tools::bogus');
		const knownResolution = resolveDocument({ document: known, namespaces, classes });
		assert.strictEqual(knownResolution.getNamespaceQualifier(positionOf(known, 'bogus')), 'tools');

		const unknown = createDocument('@return mystery::bogus');
		const unknownResolution = resolveDocument({ document: unknown, namespaces, classes });
		assert.strictEqual(unknownResolution.getNamespaceQualifier(positionOf(unknown, 'bogus')), undefined);

		const free = createDocument('@return mystery');
		const freeResolution = resolveDocument({ document: free, namespaces, classes });
		assert.strictEqual(freeResolution.getNamespaceQualifier(positionOf(free, 'mystery')), undefined);
	});

	it('marks declaration-site type tokens with the declaration flag', () => {
		const defineDocument = createDocument('@define Widget w');
		const defineResolution = resolveDocument({ document: defineDocument, namespaces, classes });
		const defineRef = defineResolution.getReferenceAtPosition(positionOf(defineDocument, 'Widget'));
		assert.strictEqual(defineRef!.token.flags?.declaration, true);

		const expressionDocument = createDocument('@return Widget');
		const expressionResolution = resolveDocument({ document: expressionDocument, namespaces, classes });
		const expressionRef = expressionResolution.getReferenceAtPosition(positionOf(expressionDocument, 'Widget'));
		assert.strictEqual(expressionRef!.token.kind, 'typeName');
		assert.notStrictEqual(expressionRef!.token.flags?.declaration, true);
	});

	it('exposes class member presence via hasMember', () => {
		const document = createDocument('@return 1');
		const resolution = resolveDocument({ document, namespaces, classes });

		assert.strictEqual(resolution.hasMember('Widget', 'name'), true);
		assert.strictEqual(resolution.hasMember('Widget', 'size()'), true);
		assert.strictEqual(resolution.hasMember('Widget', 'bogus'), false);
		assert.strictEqual(resolution.hasMember('NotAClass', 'name'), false);
	});

	it('flags non-Int array indices and non-array indexing through analyzeExpression', () => {
		const document = createDocument('@define Int[] arr\n@define Int n\n');
		const resolution = resolveDocument({ document, namespaces, classes });

		const wrongIndex = resolution.analyzeExpression('arr["zero"]', 2, 0);
		assert.strictEqual(wrongIndex.diagnostics.length, 1);
		assert.strictEqual(wrongIndex.diagnostics[0].code, 'SEM015');

		const wrongHost = resolution.analyzeExpression('n[0]', 2, 0);
		assert.strictEqual(wrongHost.diagnostics.length, 1);
		assert.strictEqual(wrongHost.diagnostics[0].code, 'SEM014');
	});

	it('treats `Type[...]` as an array literal, including via active namespace', () => {
		const document = createDocument('@using transmute\n@return 1');
		const resolution = resolveDocument({ document, namespaces, classes });

		// Bare `Machine` resolves through the active `transmute` namespace.
		const empty = resolution.analyzeExpression('Machine[]', 1, 0);
		assert.deepStrictEqual(empty.diagnostics, []);
		assert.strictEqual(empty.type, 'transmute::Machine[]');

		const populated = resolution.analyzeExpression('Widget[player, player]', 1, 0);
		assert.deepStrictEqual(populated.diagnostics, []);
		assert.strictEqual(populated.type, 'Widget[]');

		const namespaced = resolution.analyzeExpression('tools::Widget[]', 1, 0);
		assert.deepStrictEqual(namespaced.diagnostics, []);
		assert.strictEqual(namespaced.type, 'tools::Widget[]');

		// After the literal, postfix `[...]` is ordinary indexing on the array.
		const indexed = resolution.analyzeExpression('Widget[player][0]', 1, 0);
		assert.deepStrictEqual(indexed.diagnostics, []);
		assert.strictEqual(indexed.type, 'Widget');

		// Unknown uppercase identifier followed by `[` still parses as an array
		// literal so the SEM004 raised on the type token is not joined by a
		// spurious SEM001 on the closing bracket.
		const unknown = resolution.analyzeExpression('Mystery[]', 1, 0);
		assert.deepStrictEqual(unknown.diagnostics, []);
	});

	it('flags an untyped `[]` literal as SEM023', () => {
		const document = createDocument('@return 1');
		const resolution = resolveDocument({ document, namespaces, classes });

		const empty = resolution.analyzeExpression('[]', 0, 0);
		assert.strictEqual(empty.diagnostics.length, 1);
		assert.strictEqual(empty.diagnostics[0].code, 'SEM023');

		const populated = resolution.analyzeExpression('[1, 2]', 0, 0);
		assert.strictEqual(populated.diagnostics.length, 1);
		assert.strictEqual(populated.diagnostics[0].code, 'SEM023');
	});

	it('normalizes bare type names against the active namespace', () => {
		// Validators in server.ts read declared types from regex captures
		// (e.g. `@define Machine m`) and must normalize before comparing to
		// a constructor result that already carries its namespace prefix.
		const document = createDocument('@using transmute\n@return 1');
		const resolution = resolveDocument({ document, namespaces, classes });

		assert.strictEqual(resolution.normalizeType('Machine', 1), 'transmute::Machine');
		assert.strictEqual(resolution.normalizeType('Machine[]', 1), 'transmute::Machine[]');
		assert.strictEqual(resolution.normalizeType('Player', 1), 'Player');
		assert.strictEqual(resolution.normalizeType('Mystery', 1), 'Mystery');
	});

	it('resolves member access through an indexed namespace-array variable', () => {
		const document = createDocument('@using transmute\n@var machines[0].state = "x"');
		const resolution = resolveDocument({ document, namespaces, classes });

		const stateRef = resolution.getReferenceAtPosition(positionOf(document, 'state'));
		assert.ok(stateRef);
		assert.strictEqual(stateRef!.symbol.kind, 'instanceField');
		assert.strictEqual(stateRef!.symbol.name, 'transmute::Machine.state');

		const chain = resolution.analyzeExpression('machines[0].state', 1, 0);
		assert.deepStrictEqual(chain.diagnostics, []);
		assert.strictEqual(chain.type, 'String');
	});

	it('tokenizes Double/Long literal suffixes as part of the number, not as identifiers', () => {
		const document = createDocument('@define Double scale = 2.0D\n@define Long big = 10L\n');
		const resolution = resolveDocument({ document, namespaces, classes });

		// `D`/`L` should not appear as identifier tokens — they are part of the literal.
		const dToken = resolution.getTokenAtPosition(positionOf(document, '2.0D'));
		assert.ok(dToken);
		assert.strictEqual(dToken!.kind, 'numberLiteral');
		assert.strictEqual(dToken!.text, '2.0D');

		const lToken = resolution.getTokenAtPosition(positionOf(document, '10L'));
		assert.ok(lToken);
		assert.strictEqual(lToken!.kind, 'numberLiteral');
		assert.strictEqual(lToken!.text, '10L');

		// Nothing on these lines should resolve as a free reference.
		const unresolvedRefs = resolution.references.filter(ref =>
			ref.symbol.kind === 'unresolved' && (ref.token.text === 'D' || ref.token.text === 'L'));
		assert.deepStrictEqual(unresolvedRefs, []);
	});

	it('infers types for well-formed numeric literals', () => {
		const document = createDocument('@return 1');
		const resolution = resolveDocument({ document, namespaces, classes });

		const cases: [string, string][] = [
			['1', 'Int'],
			['2147483647', 'Int'],
			['1L', 'Long'],
			['9223372036854775807L', 'Long'],
			['1.5', 'Float'],
			['1.5D', 'Double'],
			['2.0d', 'Double'],
			['10l', 'Long']
		];
		for (const [literal, expectedType] of cases) {
			const analysis = resolution.analyzeExpression(literal, 0, 0);
			assert.deepStrictEqual(analysis.diagnostics, [], `unexpected diagnostics for ${literal}`);
			assert.strictEqual(analysis.type, expectedType, `wrong type for ${literal}`);
		}
	});

	it('flags out-of-range and malformed numeric literals', () => {
		const document = createDocument('@return 1');
		const resolution = resolveDocument({ document, namespaces, classes });

		// Fits in Long but not Int — the hint should suggest the L suffix.
		const fitsInLong = resolution.analyzeExpression('5000000000', 0, 0);
		assert.strictEqual(fitsInLong.diagnostics.length, 1);
		assert.strictEqual(fitsInLong.diagnostics[0].code, 'SEM024');
		assert.match(fitsInLong.diagnostics[0].message, /out of range/);
		assert.match(fitsInLong.diagnostics[0].message, /'L' suffix/);

		// User's reported case: 10^19 exceeds even Long.
		const tooBigForLongToo = resolution.analyzeExpression('10000000000000000000', 0, 0);
		assert.strictEqual(tooBigForLongToo.diagnostics.length, 1);
		assert.strictEqual(tooBigForLongToo.diagnostics[0].code, 'SEM024');
		// Hint about Long suffix should not appear when even Long can't hold it.
		assert.doesNotMatch(tooBigForLongToo.diagnostics[0].message, /'L' suffix/);

		const longOverflow = resolution.analyzeExpression('99999999999999999999L', 0, 0);
		assert.strictEqual(longOverflow.diagnostics.length, 1);
		assert.strictEqual(longOverflow.diagnostics[0].code, 'SEM024');

		const decimalLong = resolution.analyzeExpression('1.5L', 0, 0);
		assert.strictEqual(decimalLong.diagnostics.length, 1);
		assert.strictEqual(decimalLong.diagnostics[0].code, 'SEM024');
		assert.match(decimalLong.diagnostics[0].message, /decimal point/);
	});

	it('flags member access on null literal', () => {
		const document = createDocument('@return 1');
		const resolution = resolveDocument({ document, namespaces, classes });

		const analysis = resolution.analyzeExpression('null.length()', 0, 0);
		assert.strictEqual(analysis.diagnostics.length, 1);
		assert.strictEqual(analysis.diagnostics[0].code, 'SEM022');
	});

	it('reports member-access host types when the host resolves to a known class', () => {
		const document = createDocument('@define Widget w\n@return w.bogus');
		const resolution = resolveDocument({ document, namespaces, classes });

		assert.strictEqual(resolution.getMemberAccessHostType(positionOf(document, 'bogus')), 'Widget');
	});

	it('returns no host type when the receiver itself is unknown', () => {
		const unknownReceiver = createDocument('@return mystery.field');
		const unknownResolution = resolveDocument({ document: unknownReceiver, namespaces, classes });
		assert.strictEqual(unknownResolution.getMemberAccessHostType(positionOf(unknownReceiver, 'field')), undefined);

		const brokenChain = createDocument('@define Widget w\n@return w.bogus().subfield');
		const brokenResolution = resolveDocument({ document: brokenChain, namespaces, classes });
		assert.strictEqual(brokenResolution.getMemberAccessHostType(positionOf(brokenChain, 'subfield')), undefined);

		const freeIdentifier = createDocument('@return mystery');
		const freeResolution = resolveDocument({ document: freeIdentifier, namespaces, classes });
		assert.strictEqual(freeResolution.getMemberAccessHostType(positionOf(freeIdentifier, 'mystery')), undefined);
	});

	it('produces unresolved typeName references for unknown declared types', () => {
		const defineDocument = createDocument('@define Mystery x');
		const defineResolution = resolveDocument({ document: defineDocument, namespaces, classes });
		const defineRef = defineResolution.getReferenceAtPosition(positionOf(defineDocument, 'Mystery'));
		assert.ok(defineRef);
		assert.strictEqual(defineRef!.token.kind, 'typeName');
		assert.strictEqual(defineRef!.symbol.kind, 'unresolved');

		const forDocument = createDocument('@for Mystery x in items\n@done');
		const forResolution = resolveDocument({ document: forDocument, namespaces, classes });
		const forRef = forResolution.getReferenceAtPosition(positionOf(forDocument, 'Mystery'));
		assert.ok(forRef);
		assert.strictEqual(forRef!.token.kind, 'typeName');
		assert.strictEqual(forRef!.symbol.kind, 'unresolved');

		const paramDocument = createDocument('#(Mystery thing)\n@return thing');
		const paramResolution = resolveDocument({ document: paramDocument, namespaces, classes });
		const paramRef = paramResolution.getReferenceAtPosition(positionOf(paramDocument, 'Mystery'));
		assert.ok(paramRef);
		assert.strictEqual(paramRef!.token.kind, 'typeName');
		assert.strictEqual(paramRef!.symbol.kind, 'unresolved');

		const knownDocument = createDocument('@define Widget w');
		const knownResolution = resolveDocument({ document: knownDocument, namespaces, classes });
		const knownRef = knownResolution.getReferenceAtPosition(positionOf(knownDocument, 'Widget'));
		assert.ok(knownRef);
		assert.strictEqual(knownRef!.symbol.kind, 'classType');
	});
});
