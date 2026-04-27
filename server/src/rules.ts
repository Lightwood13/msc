import { Rule } from './lint';

export const RULES: Record<string, Rule> = {
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
	}
};
