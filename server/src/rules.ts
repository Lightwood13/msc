import { Rule } from './lint';

export const RULES: Record<string, Rule> = {
	SYN001: {
		code: 'SYN001',
		name: 'unclosed-if',
		category: 'syntax',
		severity: 'error',
		description: 'Unclosed @if block',
		fix: ({ totalLines }) => ({
			title: 'Insert @fi at end of file',
			edits: [{ kind: 'insert', before: totalLines, content: '@fi' }]
		})
	},
	SYN002: {
		code: 'SYN002',
		name: 'unclosed-for',
		category: 'syntax',
		severity: 'error',
		description: 'Unclosed @for block',
		fix: ({ totalLines }) => ({
			title: 'Insert @done at end of file',
			edits: [{ kind: 'insert', before: totalLines, content: '@done' }]
		})
	},
	SYN003: {
		code: 'SYN003',
		name: 'invalid-script-option',
		category: 'syntax',
		severity: 'error',
		description: 'Unknown script operator'
	},
	SYN004: {
		code: 'SYN004',
		name: 'operator-must-be-alone',
		category: 'syntax',
		severity: 'error',
		description: 'Operator must be on its own line',
		fix: ({ lineText, line }) => {
			const m = lineText.match(/^(\s*)(@else|@fi|@done|@cancel|@slow|@fast)\b/);
			if (!m) return null;
			return {
				title: 'Remove trailing content',
				edits: [{ kind: 'replace', line, content: m[1] + m[2] }]
			};
		}
	},
	SYN005: {
		code: 'SYN005',
		name: 'empty-condition',
		category: 'syntax',
		severity: 'error',
		description: '@if / @elseif must have a non-empty condition'
	},
	SYN006: {
		code: 'SYN006',
		name: 'for-syntax',
		category: 'syntax',
		severity: 'error',
		description: 'Invalid @for syntax; expected `@for <type> <variable> in <list>`'
	},
	SYN007: {
		code: 'SYN007',
		name: 'define-syntax',
		category: 'syntax',
		severity: 'error',
		description: 'Invalid @define syntax; expected `@define <type> <variable> [= <expression>]`'
	},
	SYN008: {
		code: 'SYN008',
		name: 'empty-initializer',
		category: 'syntax',
		severity: 'error',
		description: '@define with `=` must have a non-empty initializer expression'
	},
	SYN009: {
		code: 'SYN009',
		name: 'chatscript-syntax',
		category: 'syntax',
		severity: 'error',
		description: 'Invalid @chatscript syntax; expected `@chatscript <time> <group-name> <expression>`'
	},
	SYN010: {
		code: 'SYN010',
		name: 'invalid-time',
		category: 'syntax',
		severity: 'error',
		description: 'Time should be a number, optionally followed by one of `s`, `m`, `h`, `d`, `w`, or `y`'
	},
	SYN011: {
		code: 'SYN011',
		name: 'prompt-syntax',
		category: 'syntax',
		severity: 'error',
		description: 'Invalid @prompt syntax; expected `@prompt <time> <variable> [expiration-message]`'
	},
	SYN012: {
		code: 'SYN012',
		name: 'cooldown-syntax',
		category: 'syntax',
		severity: 'error',
		description: 'Invalid @cooldown / @global_cooldown syntax; expected `@cooldown <time>`'
	},
	SYN013: {
		code: 'SYN013',
		name: 'delay-syntax',
		category: 'syntax',
		severity: 'error',
		description: 'Invalid @delay syntax; expected `@delay <time>`'
	},
	SYN014: {
		code: 'SYN014',
		name: 'using-syntax',
		category: 'syntax',
		severity: 'error',
		description: 'Invalid @using syntax; expected `@using <namespace>`'
	},
	SYN015: {
		code: 'SYN015',
		name: 'command-operator-syntax',
		category: 'syntax',
		severity: 'error',
		description: '@bypass / @command / @console must be followed by a command'
	},
	SYN016: {
		code: 'SYN016',
		name: 'unmatched-block-end',
		category: 'syntax',
		severity: 'error',
		description: '@fi / @done has no matching @if / @for to close'
	},
	SYN017: {
		code: 'SYN017',
		name: 'mismatched-block-end',
		category: 'syntax',
		severity: 'error',
		description: 'Mismatched block close; use @fi for @if and @done for @for'
	},
	SYN018: {
		code: 'SYN018',
		name: 'unmatched-else',
		category: 'syntax',
		severity: 'error',
		description: '@else / @elseif used outside of an @if-@fi block'
	},
	SYN019: {
		code: 'SYN019',
		name: 'multiple-else',
		category: 'syntax',
		severity: 'error',
		description: '@else / @elseif appears after @else in the same @if-@fi block'
	},
	SYN020: {
		code: 'SYN020',
		name: 'header-operator-placement',
		category: 'syntax',
		severity: 'error',
		description: '@cooldown / @global_cooldown / @cancel must appear in the script header, before executable statements'
	},
	SYN021: {
		code: 'SYN021',
		name: 'duplicate-return',
		category: 'syntax',
		severity: 'error',
		description: 'Two @return statements cannot appear in the same conditional clause'
	},
	SEM001: {
		code: 'SEM001',
		name: 'invalid-operator-types',
		category: 'semantic',
		severity: 'error',
		description: 'Operator is not applicable to the surrounding expression types'
	},
	SEM002: {
		code: 'SEM002',
		name: 'unknown-type',
		category: 'semantic',
		severity: 'error',
		description: 'Unknown type'
	},
	SEM003: {
		code: 'SEM003',
		name: 'unknown-member',
		category: 'semantic',
		severity: 'error',
		description: 'Unknown member'
	},
	SEM004: {
		code: 'SEM004',
		name: 'undefined-identifier',
		category: 'semantic',
		severity: 'error',
		description: 'Identifier is not defined in the current scope'
	},
	SEM005: {
		code: 'SEM005',
		name: 'unknown-namespace',
		category: 'semantic',
		severity: 'error',
		description: 'Unknown namespace'
	},
	SEM006: {
		code: 'SEM006',
		name: 'unknown-namespace-member',
		category: 'semantic',
		severity: 'error',
		description: 'Namespace has no member with this name'
	},
	SEM007: {
		code: 'SEM007',
		name: 'non-boolean-condition',
		category: 'semantic',
		severity: 'error',
		description: 'Condition must evaluate to Boolean'
	},
	SEM008: {
		code: 'SEM008',
		name: 'non-array-iterable',
		category: 'semantic',
		severity: 'error',
		description: '@for iterable must be an array type'
	},
	SEM009: {
		code: 'SEM009',
		name: 'for-element-type-mismatch',
		category: 'semantic',
		severity: 'error',
		description: '@for variable type does not match the array element type'
	},
	SEM010: {
		code: 'SEM010',
		name: 'define-type-mismatch',
		category: 'semantic',
		severity: 'error',
		description: '@define initializer type does not match the declared type'
	},
	SEM011: {
		code: 'SEM011',
		name: 'assign-type-mismatch',
		category: 'semantic',
		severity: 'error',
		description: '@var assignment type does not match the variable type'
	},
	SEM012: {
		code: 'SEM012',
		name: 'empty-interpolation',
		category: 'semantic',
		severity: 'error',
		description: 'Empty {{}} interpolation has no expression'
	},
	SEM013: {
		code: 'SEM013',
		name: 'no-matching-overload',
		category: 'semantic',
		severity: 'error',
		description: 'No overload accepts the supplied arguments'
	},
	SEM014: {
		code: 'SEM014',
		name: 'index-non-array',
		category: 'semantic',
		severity: 'error',
		description: 'Cannot index a non-array type'
	},
	SEM015: {
		code: 'SEM015',
		name: 'non-int-index',
		category: 'semantic',
		severity: 'error',
		description: 'Array index must be Int'
	},
	SEM016: {
		code: 'SEM016',
		name: 'not-callable',
		category: 'semantic',
		severity: 'error',
		description: 'Cannot call a value that is not a function, method, or constructor'
	},
	SEM017: {
		code: 'SEM017',
		name: 'duplicate-declaration',
		category: 'semantic',
		severity: 'error',
		description: 'Variable already declared in this scope'
	},
	SEC001: {
		code: 'SEC001',
		name: 'bypass-script-banned',
		category: 'security',
		severity: 'error',
		description: 'Calling /script via @bypass or @console is no longer allowed, use @command instead',
		fix: ({ lineText, line }) => ({
			title: 'Replace with @command',
			edits: [{ kind: 'replace', line, content: lineText.replace(/^(\s*)@(bypass|console)\b/, '$1@command') }]
		})
	},
	SEC002: {
		code: 'SEC002',
		name: 'permission-commands-banned',
		category: 'security',
		severity: 'error',
		description: 'Permission-changing commands are banned in scripts',
		fix: ({ line }) => ({
			title: 'Delete this line',
			edits: [{ kind: 'delete', line }]
		})
	},
	SEC003: {
		code: 'SEC003',
		name: 'chat-commands-banned',
		category: 'security',
		severity: 'error',
		description: 'Chat commands are banned in scripts',
		fix: ({ line }) => ({
			title: 'Delete this line',
			edits: [{ kind: 'delete', line }]
		})
	},
	SEC004: {
		code: 'SEC004',
		name: 'dynamic-commands-banned',
		category: 'security',
		severity: 'error',
		description: 'Commands with a template-expression name are banned in scripts',
		fix: ({ line }) => ({
			title: 'Delete this line',
			edits: [{ kind: 'delete', line }]
		})
	},
	STY001: {
		code: 'STY001',
		name: 'lowercase-variable-name',
		category: 'style',
		severity: 'error',
		description: 'Variable names must start with a lowercase letter and contain only letters, digits, or underscores'
	},
	STY002: {
		code: 'STY002',
		name: 'unreachable-after-return',
		category: 'style',
		severity: 'warning',
		description: 'Code after @return in the same block is unreachable'
	}
};
