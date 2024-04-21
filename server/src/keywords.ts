
import {
	CompletionItem,
	CompletionItemKind,
	InsertTextFormat
} from 'vscode-languageserver/node';

export const keywords: CompletionItem[] =
	[
		{
			"label": "if else",
			"detail": "Conditional (if) statement",
			"kind": CompletionItemKind.Snippet,
			"filterText": "if condition",
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
			"filterText": "if branch",
			"insertText": "@if (${1:condition})\n\t$2\n@elseif (${3:condition})\n\t$4\n@else\n\t$5\n@fi",
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "@if (condition)\n\tdo stuff\n@elseif (other condition)\n\tdo other stuff\n@else\n\tdo this otherwise\n@fi"
			}
		},
		{
			"label": "elseif",
			"detail": "Alternate condition",
			"kind": CompletionItemKind.Snippet,
			"filterText": "elseif elif",
			"insertText": "@elseif (${1:condition})",
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "@elseif (${1:condition})"
			}
		},
		{
			"label": "for",
			"detail": "For loop (iteration)",
			"kind": CompletionItemKind.Snippet,
			"filterText": "for repeat",
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
			"filterText": "define def let",
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
			"filterText": "player print display output",
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
			"filterText": "chatscript cs onclick",
			"insertText": "@chatscript ${1:10s} ${2:group-name} ${3:function()}",
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
			"filterText": "prompt input",
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
			"filterText": "delay wait pause",
			"insertText": "@delay ${1:1s}",
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "@delay 1s"
			}
		},
		{
			"label": "bypass",
			"detail": "Run a command",
			"kind": CompletionItemKind.Snippet,
			"filterText": "bypass command",
			"insertText": "@bypass /${1:command}",
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "@bypass /command"
			}
		},
		{
			"label": "command",
			"detail": "Run a command as the player",
			"kind": CompletionItemKind.Snippet,
			"filterText": "command",
			"insertText": "@command /${1:command}",
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "@command /command"
			}
		},
		{
			"label": "console",
			"detail": "Run a command as the console",
			"kind": CompletionItemKind.Snippet,
			"filterText": "console command",
			"insertText": "@console /${1:command}",
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "@console /command"
			}
		},
		{
			"label": "cooldown",
			"detail": "Add a cooldown to this script",
			"kind": CompletionItemKind.Snippet,
			"filterText": "cooldown",
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
			"filterText": "global_cooldown",
			"insertText": "@global_cooldown ${1:1s}",
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "@global_cooldown 1s"
			}
		},
		{
			"label": "using",
			"detail": "Changes default namespace",
			"kind": CompletionItemKind.Snippet,
			"filterText": "using namespace",
			"insertText": "@using ${1:namespace}",
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "@using namespace"
			}
		},
		{
			"label": "cancel",
			"detail": "Terminates a player's interaction",
			"kind": CompletionItemKind.Keyword,
			"filterText": "cancel",
			"insertText": "@cancel"
		},
		{
			"label": "done",
			"detail": "Ends an @for loop",
			"kind": CompletionItemKind.Keyword,
			"filterText": "done endfor",
			"insertText": "@done"
		},
		{
			"label": "else",
			"detail": "Runs if no other conditions have been met",
			"kind": CompletionItemKind.Keyword,
			"filterText": "else",
			"insertText": "@else"
		},
		{
			"label": "fast",
			"detail": "Removes the 1-tick delay from commands",
			"kind": CompletionItemKind.Keyword,
			"filterText": "fast",
			"insertText": "@fast"
		},
		{
			"label": "fi",
			"detail": "Ends a conditional branch",
			"kind": CompletionItemKind.Keyword,
			"filterText": "fi endif",
			"insertText": "@fi"
		},
		{
			"label": "return",
			"detail": "Ends execution, optionally returning an argument",
			"kind": CompletionItemKind.Keyword,
			"filterText": "return",
			"insertText": "@return "
		},
		{
			"label": "slow",
			"detail": "Nullifies a previous @fast",
			"kind": CompletionItemKind.Keyword,
			"filterText": "slow",
			"insertText": "@slow"
		},
		{
			"label": "var",
			"detail": "Runs a function or assigns a variable",
			"kind": CompletionItemKind.Keyword,
			"filterText": "var run set",
			"insertText": "@var "
		}
	];

export const keywordsWithoutAtSymbol: CompletionItem[] = keywords.map(suggestion =>
({
	...suggestion,
	insertText: suggestion.insertText?.substring(1)
})
);


export const keywordCommands: CompletionItem[] =
	[
		{
			"label": "setblock",
			"detail": "Changes a block",
			"kind": CompletionItemKind.Snippet,
			"filterText": "setblock",
			"insertText": "execute in ${1:minecraft:theta} run setblock ${2:x} ${3:y} ${4:z} minecraft:${5:air}",
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "/execute in minecraft:theta run setblock 123 45 678 minecraft:air"
			}
		},
		{
			"label": "give",
			"detail": "Gives the player an item",
			"kind": CompletionItemKind.Snippet,
			"filterText": "give",
			"insertText": "give ${1:{{player}}} minecraft:${2:apple} ${3:1}",
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "/give {{player}} apple 1"
			}
		}
	];