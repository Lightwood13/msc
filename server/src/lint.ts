import { Diagnostic, DiagnosticSeverity, Range, TextEdit } from 'vscode-languageserver/node';

export type LineOp =
	| { kind: 'replace'; line: number; content: string }
	| { kind: 'delete'; line: number }
	| { kind: 'insert'; before: number; content: string };

export type RuleSeverity = 'error' | 'warning' | 'info';

// lexical  — source can't be tokenised (stray chars, unterminated literals)
// syntax   — token stream doesn't match the grammar (unclosed @for, bad @delay)
// semantic — context-dependent (undefined names, type mismatches)
// security — valid MSC the server explicitly disallows
// style    — runs fine, but recommended against
export type RuleCategory = 'lexical' | 'syntax' | 'semantic' | 'security' | 'style';

export interface Fix {
	title: string;
	edits: LineOp[];
}

export interface FixContext {
	lineText: string;
	line: number;
	totalLines: number;
}

export interface Rule {
	code: string;
	name: string;
	category: RuleCategory;
	severity: RuleSeverity;
	description: string;
	fix?: (ctx: FixContext) => Fix | Fix[] | null;
}

export const RULES: Record<string, Rule> = {
	SEC001: {
		code: 'SEC001',
		name: 'bypass-script-banned',
		category: 'security',
		severity: 'error',
		description: '@bypass /script is no longer allowed, use @command /script instead',
		fix: ({ lineText, line }) => ({
			title: 'Replace @bypass with @command',
			edits: [{ kind: 'replace', line, content: lineText.replace(/@bypass\b/, '@command') }]
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

const SEVERITIES: Record<RuleSeverity, DiagnosticSeverity> = {
	error: DiagnosticSeverity.Error,
	warning: DiagnosticSeverity.Warning,
	info: DiagnosticSeverity.Information
};

export function raise(diagnostics: Diagnostic[], rule: Rule, range: Range, message?: string): void {
	diagnostics.push({
		severity: SEVERITIES[rule.severity],
		range,
		message: message ?? rule.description,
		code: rule.code,
		source: 'msc'
	});
}

// Apply line ops back-to-front so earlier line indices remain valid.
export function lineOpsToEdits(ops: LineOp[]): TextEdit[] {
	const at = (op: LineOp) => op.kind === 'insert' ? op.before : op.line;
	return [...ops].sort((a, b) => at(b) - at(a)).map(op => {
		if (op.kind === 'insert') {
			const pos = { line: op.before, character: 0 };
			return { range: { start: pos, end: pos }, newText: op.content + '\n' };
		}
		const range: Range = { start: { line: op.line, character: 0 }, end: { line: op.line + 1, character: 0 } };
		return { range, newText: op.kind === 'delete' ? '' : op.content + '\n' };
	});
}
