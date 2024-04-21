
import {
	CompletionItem,
	CompletionItemKind,
	InsertTextFormat
} from 'vscode-languageserver/node';

export const keywords: CompletionItem[] =
	[
		{
			"label": "if",
			"detail": "Conditional (if) statement",
			"kind": CompletionItemKind.Snippet,
			"insertText": "@if (${1:condition})\n\t$2\n@fi",
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "@if (condition)\n\tdo stuff\n@fi"
			}
		},
		{
			"label": "if elseif else",
			"detail": "Branch (if/elseif/else) statement",
			"kind": CompletionItemKind.Snippet,
			"insertText": "@if (${1:condition})\n\t$2\n@elseif (${3:condition})\n\t$4\n@else\n\t$5\n@fi",
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "@if (condition)\n\tdo stuff\n@elseif (other condition)\n\tdo other stuff\n@else\n\tdo this otherwise\n@fi"
			}
		},
		{
			"label": "for",
			"detail": "For loop (iteration)",
			"kind": CompletionItemKind.Snippet,
			"insertText": "@for ${1:Int} ${2:i} in ${3:list::range(0, 10)}\n\t$0\n@done",
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "@for Int i in list::range(0, 10)\n\tdo stuff\n@done"
			}
		},
		{
			"label": "define",
			"detail": "Define a variable",
			"kind": CompletionItemKind.Snippet,
			"insertText": "@define ${1:Int} ${2:myVar} = ${3:0}",
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "@define Int myVar = 0"
			}
		},
		{
			"label": "player",
			"detail": "Display a chat message to the player",
			"kind": CompletionItemKind.Snippet,
			"insertText": "@player ${1:hello}",
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "@player text to display"
			}
		},
		{
			"label": "print",
			"detail": "Display a chat message to the player",
			"kind": CompletionItemKind.Snippet,
			"insertText": "@player ${1:hello}",
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "@player text to display"
			}
		},
		{
			"label": "chatscript",
			"detail": "Add a script to the last chat message",
			"kind": CompletionItemKind.Snippet,
			"insertText": "@chatscript ${1:10s} ${2:groupname} ${3:do_stuff()}",
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "@chatscript 10s groupname do_stuff()"
			}
		},
		{
			"label": "prompt",
			"detail": "Prompt the player",
			"kind": CompletionItemKind.Snippet,
			"insertText": "@prompt ${1:10s} ${2:myStringVar} ${3:Prompt expired}",
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "@prompt 10s myStringVar Prompt expired"
			}
		},
		{
			"label": "delay",
			"detail": "Delay continued script execution",
			"kind": CompletionItemKind.Snippet,
			"insertText": "@delay ${1:1s}",
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "@delay 1s"
			}
		},
		{
			"label": "cooldown",
			"detail": "Add a cooldown to this script",
			"kind": CompletionItemKind.Snippet,
			"insertText": "@cooldown ${1:1s}",
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "@cooldown 1s"
			}
		},
		{
			"label": "global cooldown",
			"detail": "Add a global cooldown to this script",
			"kind": CompletionItemKind.Snippet,
			"insertText": "@global_cooldown ${1:1s}",
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "@global_cooldown 1s"
			}
		},
		{
			"label": "bypass",
			"kind": CompletionItemKind.Keyword,
			"insertText": "@bypass ",
			command: {
				title: 'Trigger Suggest',
				command: 'editor.action.triggerSuggest'
			}
		},
		{
			"label": "cancel",
			"kind": CompletionItemKind.Keyword,
			"insertText": "@cancel"
		},
		{
			"label": "chatscript",
			"kind": CompletionItemKind.Keyword,
			"insertText": "@chatscript"
		},
		{
			"label": "command",
			"kind": CompletionItemKind.Keyword,
			"insertText": "@command"
		},
		{
			"label": "console",
			"kind": CompletionItemKind.Keyword,
			"insertText": "@console"
		},
		{
			"label": "cooldown",
			"kind": CompletionItemKind.Keyword,
			"insertText": "@cooldown"
		},
		{
			"label": "define",
			"kind": CompletionItemKind.Keyword,
			"insertText": "@define"
		},
		{
			"label": "delay",
			"kind": CompletionItemKind.Keyword,
			"insertText": "@delay"
		},
		{
			"label": "done",
			"kind": CompletionItemKind.Keyword,
			"insertText": "@done"
		},
		{
			"label": "else",
			"kind": CompletionItemKind.Keyword,
			"insertText": "@else"
		},
		{
			"label": "elseif",
			"kind": CompletionItemKind.Keyword,
			"insertText": "@elseif"
		},
		{
			"label": "fast",
			"kind": CompletionItemKind.Keyword,
			"insertText": "@fast"
		},
		{
			"label": "fi",
			"kind": CompletionItemKind.Keyword,
			"insertText": "@fi"
		},
		{
			"label": "for",
			"kind": CompletionItemKind.Keyword,
			"insertText": "@for"
		},
		{
			"label": "global_cooldown",
			"kind": CompletionItemKind.Keyword,
			"insertText": "@global_cooldown"
		},
		{
			"label": "if",
			"kind": CompletionItemKind.Keyword,
			"insertText": "@if"
		},
		{
			"label": "player",
			"kind": CompletionItemKind.Keyword,
			"insertText": "@player"
		},
		{
			"label": "prompt",
			"kind": CompletionItemKind.Keyword,
			"insertText": "@prompt"
		},
		{
			"label": "return",
			"kind": CompletionItemKind.Keyword,
			"insertText": "@return"
		},
		{
			"label": "slow",
			"kind": CompletionItemKind.Keyword,
			"insertText": "@slow"
		},
		{
			"label": "using",
			"kind": CompletionItemKind.Keyword,
			"insertText": "@using"
		},
		{
			"label": "var",
			"kind": CompletionItemKind.Keyword,
			"insertText": "@var"
		}
	];


export const keywordsWithoutAtSymbol: CompletionItem[] = keywords.map(suggestion =>
({
	...suggestion,
	insertText: suggestion.insertText?.substring(1)
})
);