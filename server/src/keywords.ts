
import { CompletionItem } from 'vscode-languageserver/node';

export const keywords: CompletionItem[] =
	[
		{
			"label": "if",
			"detail": "If statement",
			"kind": 15,
			"insertText": "@if $1\n\t$0\n@fi",
			"insertTextFormat": 2,
			"documentation": {
				"kind": "plaintext",
				"value": "@if condition\n\tdo stuff\n@fi"
			}
		},
		{
			"label": "if else",
			"detail": "If-else statement",
			"kind": 15,
			"insertText": "@if $1\n\t$0\n@else\n\t\n@fi",
			"insertTextFormat": 2,
			"documentation": {
				"kind": "plaintext",
				"value": "@if condition\n\tdo stuff\n@else\n\tdo other stuff\n@fi"
			}
		},
		{
			"label": "for",
			"detail": "For loop",
			"kind": 15,
			"insertText": "@for ${1:Int} ${2:i} in ${3:list::range(0, 10)}\n\t$0\n@done",
			"insertTextFormat": 2,
			"documentation": {
				"kind": "plaintext",
				"value": "@for Int i in list::range(0, 10)\n\tdo stuff\n@done"
			}
		},
		{
			"label": "define",
			"detail": "Define variable",
			"kind": 15,
			"insertText": "@define ${1:Int} ${2:myVar} = ${3:0}",
			"insertTextFormat": 2,
			"documentation": {
				"kind": "plaintext",
				"value": "@define Int myVar = 0"
			}
		},
		{
			"label": "player",
			"detail": "Say message to player",
			"kind": 15,
			"insertText": "@player ${1:hello}",
			"insertTextFormat": 2,
			"documentation": {
				"kind": "plaintext",
				"value": "@player hello"
			}
		},
		{
			"label": "print",
			"detail": "Say message to player",
			"kind": 15,
			"insertText": "@player ${1:hello}",
			"insertTextFormat": 2,
			"documentation": {
				"kind": "plaintext",
				"value": "@player hello"
			}
		},
		{
			"label": "chatscript",
			"detail": "Add script to the last chat message",
			"kind": 15,
			"insertText": "@chatscript ${1:10s} ${2:groupname} ${3:do_stuff()}",
			"insertTextFormat": 2,
			"documentation": {
				"kind": "plaintext",
				"value": "@chatscript 10s groupname do_stuff()"
			}
		},
		{
			"label": "prompt",
			"detail": "Prompt the player",
			"kind": 15,
			"insertText": "@prompt ${1:10s} ${2:myStringVar} ${3:Prompt expired}",
			"insertTextFormat": 2,
			"documentation": {
				"kind": "plaintext",
				"value": "@prompt 10s myStringVar Prompt expired"
			}
		},
		{
			"label": "delay",
			"detail": "Delay script execution",
			"kind": 15,
			"insertText": "@delay ${1:1s}",
			"insertTextFormat": 2,
			"documentation": {
				"kind": "plaintext",
				"value": "@delay 1s"
			}
		},
		{
			"label": "cooldown",
			"detail": "Add cooldown to this script",
			"kind": 15,
			"insertText": "@cooldown ${1:1s}",
			"insertTextFormat": 2,
			"documentation": {
				"kind": "plaintext",
				"value": "@cooldown 1s"
			}
		},
		{
			"label": "global cooldown",
			"detail": "Add global cooldown to this script",
			"kind": 15,
			"insertText": "@global_cooldown ${1:1s}",
			"insertTextFormat": 2,
			"documentation": {
				"kind": "plaintext",
				"value": "@global_cooldown 1s"
			}
		},
		{
			"label": "bypass",
			"kind": 14,
			"insertText": "@bypass"
		},
		{
			"label": "cancel",
			"kind": 14,
			"insertText": "@cancel"
		},
		{
			"label": "chatscript",
			"kind": 14,
			"insertText": "@chatscript"
		},
		{
			"label": "command",
			"kind": 14,
			"insertText": "@command"
		},
		{
			"label": "console",
			"kind": 14,
			"insertText": "@console"
		},
		{
			"label": "cooldown",
			"kind": 14,
			"insertText": "@cooldown"
		},
		{
			"label": "define",
			"kind": 14,
			"insertText": "@define"
		},
		{
			"label": "delay",
			"kind": 14,
			"insertText": "@delay"
		},
		{
			"label": "done",
			"kind": 14,
			"insertText": "@done"
		},
		{
			"label": "else",
			"kind": 14,
			"insertText": "@else"
		},
		{
			"label": "elseif",
			"kind": 14,
			"insertText": "@elseif"
		},
		{
			"label": "fast",
			"kind": 14,
			"insertText": "@fast"
		},
		{
			"label": "fi",
			"kind": 14,
			"insertText": "@fi"
		},
		{
			"label": "for",
			"kind": 14,
			"insertText": "@for"
		},
		{
			"label": "global_cooldown",
			"kind": 14,
			"insertText": "@global_cooldown"
		},
		{
			"label": "if",
			"kind": 14,
			"insertText": "@if"
		},
		{
			"label": "player",
			"kind": 14,
			"insertText": "@player"
		},
		{
			"label": "prompt",
			"kind": 14,
			"insertText": "@prompt"
		},
		{
			"label": "return",
			"kind": 14,
			"insertText": "@return"
		},
		{
			"label": "slow",
			"kind": 14,
			"insertText": "@slow"
		},
		{
			"label": "using",
			"kind": 14,
			"insertText": "@using"
		},
		{
			"label": "var",
			"kind": 14,
			"insertText": "@var"
		}
	];


export const keywordsWithoutAtSymbol: CompletionItem[] = keywords.map( suggestion =>
	({
		...suggestion,
		insertText: suggestion.insertText?.substring(1)
	})
);