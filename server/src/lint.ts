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

export interface Suppressions {
	perLine: Map<number, Set<string> | 'any'>;
	file: Set<string> | 'any';
}

// Recognised: # msc-ignore [file] [any|all|<CODE>...]
// Bare `msc-ignore` and the filler tokens `any`/`all` mean "all codes".
// Line-scope attaches to the next non-blank, non-comment line.
export function parseSuppressions(lines: string[]): Suppressions {
	const perLine = new Map<number, Set<string> | 'any'>();
	let file: Set<string> | 'any' = new Set<string>();
	const FILLER = new Set(['any', 'all']);

	const isContentful = (s: string) => {
		const t = s.trim();
		return t !== '' && !t.startsWith('# ');
	};

	const findNextContentful = (from: number): number => {
		for (let j = from; j < lines.length; j++) {
			if (isContentful(lines[j])) return j;
		}
		return -1;
	};

	for (let i = 0; i < lines.length; i++) {
		const m = /^\s*#\s*msc-ignore(?:\s+(.*))?$/.exec(lines[i]);
		if (!m) continue;
		const tokens = (m[1] ?? '').trim().split(/\s+/).filter(Boolean);
		const isFile = tokens[0] === 'file';
		const rest = isFile ? tokens.slice(1) : tokens;
		const codeTokens = rest.filter(t => !FILLER.has(t));
		const isAll = rest.some(t => FILLER.has(t)) || codeTokens.length === 0;

		if (isFile) {
			if (file === 'any') continue;
			if (isAll) { file = 'any'; continue; }
			for (const c of codeTokens) file.add(c);
		} else {
			const target = findNextContentful(i + 1);
			if (target === -1) continue;
			const existing = perLine.get(target);
			if (existing === 'any') continue;
			if (isAll) { perLine.set(target, 'any'); continue; }
			const set = existing ?? new Set<string>();
			for (const c of codeTokens) set.add(c);
			perLine.set(target, set);
		}
	}

	return { perLine, file };
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
