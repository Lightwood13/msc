
import {
	CompletionItem,
	CompletionItemKind,
	InsertTextFormat
} from 'vscode-languageserver/node';

import * as minecraftBlocksData from './data/minecraftBlocks.json';
import * as minecraftItemsData from './data/minecraftItems.json';

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

const commandSelectors = "{{player}},@s,@p,@a,@e";
const worldNames = "theta,theta_nether,theta_the_end,overworld,the_nether,the_end";
const allMinecraftBlocks = minecraftBlocksData.map(block => `${block}`).join(',');
const allMinecraftItems = minecraftItemsData.map(block => `${block}`).join(',');

export const keywordCommands: CompletionItem[] =
	[
		{
			"label": "setblock",
			"detail": "Changes a block",
			"kind": CompletionItemKind.Snippet,
			"filterText": "setblock",
			"insertText": `execute in minecraft:\${1|${worldNames}|} run setblock \${2:x} \${3:y} \${4:z} minecraft:\${5|${allMinecraftBlocks}|} \${6|replace,destroy,keep|} `,
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "/execute in <worldname> run setblock <coordinates> minecraft:<block>"
			}
		},
		{
			"label": "give",
			"detail": "Gives the player an item",
			"kind": CompletionItemKind.Snippet,
			"filterText": "give",
			"insertText": `give \${1|${commandSelectors}|} minecraft:\${2|${allMinecraftItems}|} \${3:1} `,
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "/give <selector> minecraft:<item> <quantity>"
			}
		},

	];


// /clear <#player> [#item]
// /clone <!coord> <!coord> <!coord> <!coord> <!coord> <!coord> <!coord> <!coord> <!coord> [filtered|masked|replace] [#block|#blocktag] [force|move|normal]
// /data <get|merge|modify|remove> <block> [#blockselector]
// /data <get|merge|modify|remove> <entity> [#entityselector]
// /effect <clear> <#entityselector> [#effect]
// /effect <give> <#entityselector> <#effect>
// /enchant <#entityselector> <#enchantment> [#integer]
// /execute <align|anchored|as|at|facing|in|positioned|rotated|run>
// /experience <add|set> <#playerselector> <!integer> <points|levels>
// /fill <!coord> <!coord> <!coord> <!coord> <!coord> <!coord> <#block> [destroy|hollow|keep|outline]
// /fill <!coord> <!coord> <!coord> <!coord> <!coord> <!coord> <#block> [replace] [#block|#blocktag]
// /gamemode <adventure|creative|survival> [#playerselector]
// /give <#playerselector> <#item> [!integer]
// /item <replace> <entity> <#entityselector> <#slot> <with> <#item>
// /item <replace> <entity> <#entityselector> <#slot> <from> <entity> <#entityselector>
// /item <replace> <entity> <#entityselector> <#slot> <from> <block> <!coord> <!coord> <!coord>
// /item <replace> <block> <!coord> <!coord> <!coord> <#slot> <with> <#item>
// /item <replace> <block> <!coord> <!coord> <!coord> <#slot> <from> <entity> <#entityselector>
// /item <replace> <block> <!coord> <!coord> <!coord> <#slot> <from> <block> <!coord> <!coord> <!coord>
// /particle <#particle> <!fcoord> <!fcoord> <!fcoord> [!float] [!float] [!float] [!float] [!integer] [force|normal]
// /playsound <#sound> <master|ambient|block|hostile|music|neutral|player|record|voice|weather> <#playerselector> <!fcoord> <!fcoord> <!fcoord> <!float> <!float>
// /scoreboard <objectives> <add|modify|remove>
// /scoreboard <players> <add|enable|get|operation|remove|reset|set>
// /setblock <!coord> <!coord> <!coord> <#block> [destroy|keep]
// /setblock <!coord> <!coord> <!coord> <#block> [replace] [#block|#blocktag]
// /tag <#entityselector> <add|remove> <!string>
// /teleport <#entityselector> [#entityselector]
// /teleport [#entityselector] <!fcoord> <!fcoord> <!fcoord>
// /tellraw [#playerselector] <!json>
// /title [#playerselector] <title|subtitle|actionbar> <!json>
// /title [#playerselector] <times> <!float> <!float> <!float>
// /title [#playerselector] <clear|reset>