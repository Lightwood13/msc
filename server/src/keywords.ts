
import {
	CompletionItem,
	CompletionItemKind,
	InsertTextFormat
} from 'vscode-languageserver/node';

// data is taken from https://github.com/misode/mcmeta/blob/registries
import * as minecraftBlockData from './data/minecraftBlocks.json';
import * as minecraftItemData from './data/minecraftItems.json';
import * as minecraftEntityData from './data/minecraftEntities.json';
import * as minecraftEffectData from './data/minecraftEffects.json';

export const keywords: CompletionItem[] =
	[
		{
			"label": "if",
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
			"label": "if else",
			"detail": "Conditional (if/else) statement",
			"kind": CompletionItemKind.Snippet,
			"filterText": "if/else condition",
			"insertText": "@if (${1:condition})\n\t$2\n@else\n\t$3\n@fi",
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "@if (condition)\n\tdo stuff\nelse\n\tdo other stuff\n@fi"
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
				"value": "@if (condition)\n\tdo stuff\n@elseif (another condition)\n\tdo other stuff\n@else\n\tdo this otherwise\n@fi"
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
			"insertText": "@bypass /",
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "@bypass /command"
			},
			"command": {
				"title": "Trigger Suggest",
				"command": "editor.action.triggerSuggest"
			}
		},
		{
			"label": "command",
			"detail": "Run a command as the player",
			"kind": CompletionItemKind.Snippet,
			"filterText": "command",
			"insertText": "@command /",
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "@command /command"
			},
			"command": {
				"title": "Trigger Suggest",
				"command": "editor.action.triggerSuggest"
			}
		},
		{
			"label": "console",
			"detail": "Run a command as the console",
			"kind": CompletionItemKind.Snippet,
			"filterText": "console command",
			"insertText": "@console /",
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "@console /command"
			},
			"command": {
				"title": "Trigger Suggest",
				"command": "editor.action.triggerSuggest"
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
			"detail": "Ends execution, optionally returning a value",
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

const entitySelectors = "{{player}},@s,@p,@a,@e,@n";
const worldNames = "theta,theta_nether,theta_the_end,overworld,the_nether,the_end,epsilon,epsilon_nether,epsilon_the_end";
const allMinecraftBlocks = minecraftBlockData.join(',');
const allMinecraftItems = minecraftItemData.join(',');
const allMinecraftEntities = minecraftEntityData.join(',');
const allMinecraftEffects = minecraftEffectData.join(',');

export const minecraftCommands: CompletionItem[] =
	[
		{
			"label": "setblock",
			"detail": "Changes a block",
			"kind": CompletionItemKind.Snippet,
			"filterText": "setblock",
			"insertText": `execute in minecraft:\${1|${worldNames}|} run setblock \${2:x} \${3:y} \${4:z} minecraft:\${5|${allMinecraftBlocks}|} \${6|replace,destroy,keep|}`,
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "/execute in <worldname> run setblock <coordinates> minecraft:<block>"
			}
		},
		{
			"label": "fill",
			"detail": "Changes a range of blocks",
			"kind": CompletionItemKind.Snippet,
			"filterText": "fill",
			"insertText": `execute in minecraft:\${1|${worldNames}|} run fill \${2:startX} \${3:startY} \${4:startZ} \${5:endX} \${6:endY} \${7:endZ} minecraft:\${8|${allMinecraftBlocks}|} \${9|replace,destroy,keep|}`,
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "/execute in <worldname> run fill <startCoordinates> <endCoordinates> minecraft:<block>"
			}
		},
		{
			"label": "give",
			"detail": "Gives the player an item",
			"kind": CompletionItemKind.Snippet,
			"filterText": "give",
			"insertText": `give \${1|${entitySelectors}|} minecraft:\${2|${allMinecraftItems}|} \${3:1}`,
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "/give <entity> minecraft:<item> <quantity>"
			}
		},
		{
			"label": "tag",
			"detail": "Adds/removes a tag from an entity",
			"kind": CompletionItemKind.Snippet,
			"filterText": "tag",
			"insertText": `tag \${1|${entitySelectors}|} \${2|add,remove|} \${3:tag_name}`,
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "/gamemode <gamemode> <entity>"
			}
		},
		{
			"label": "teleport",
			"detail": "Teleports an entity/player to the desired location",
			"kind": CompletionItemKind.Snippet,
			"filterText": "teleport tp",
			"insertText": `execute in minecraft:\${1|${worldNames}|} run teleport \${2|${entitySelectors}|} \${3:x} \${4:y} \${5:z} \${6:pitch} \${7:yaw}`,
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "/execute in <worldname> run teleport <entity> <coordinates> <pitch> <yaw>"
			}
		},
		{
			"label": "clear",
			"detail": "Clears all items from a player's inventory",
			"kind": CompletionItemKind.Snippet,
			"filterText": "clear",
			"insertText": `clear \${1|${entitySelectors}|}`,
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "/clear <player>"
			}
		},
		{
			"label": "clear item",
			"detail": "Clears a specific item from a player's inventory",
			"kind": CompletionItemKind.Snippet,
			"filterText": "clear item",
			"insertText": `clear \${1|${entitySelectors}|} minecraft:\${2|${allMinecraftItems}|}`,
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "/clear <player> <item>"
			}
		},
		{
			"label": "effect give",
			"detail": "Gives a status effect to an entity",
			"kind": CompletionItemKind.Snippet,
			"filterText": "effect give",
			"insertText": `effect give \${1|${entitySelectors}|} minecraft:\${2|${allMinecraftEffects}|} \${3:duration} \${4:amplifier}`,
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "/effect give <entity> <effect> <duration> <amplifier>"
			}
		},
		{
			"label": "effect clear",
			"detail": "Clears status effects from an entity",
			"kind": CompletionItemKind.Snippet,
			"filterText": "effect clear",
			"insertText": `effect clear \${1|${entitySelectors}|}`,
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "/effect clear <entity>"
			}
		},
		{
			"label": "summon",
			"detail": "Summons an entity",
			"kind": CompletionItemKind.Snippet,
			"filterText": "summon",
			"insertText": `execute in minecraft:\${1|${worldNames}|} run summon minecraft:\${2|${allMinecraftEntities}|} \${3:x} \${4:y} \${5:z}`,
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "/execute in <worldname> run summon <entity> <coordinates>"
			}
		},
		{
			"label": "clone",
			"detail": "Clones a region of blocks",
			"kind": CompletionItemKind.Snippet,
			"filterText": "clone",
			"insertText": `execute in minecraft:\${1|${worldNames}|} run clone \${2:srcX1} \${3:srcY1} \${4:srcZ1} \${5:srcX2} \${6:srcY2} \${7:srcZ2} \${8:destX} \${9:destY} \${10:destZ} \${11|replace,masked,filtered|}`,
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "/execute in <worldname> run clone <src1> <src2> <dest> [replace|masked|filtered]"
			}
		},
		{
			"label": "enchant",
			"detail": "Enchants an entity's held item",
			"kind": CompletionItemKind.Snippet,
			"filterText": "enchant",
			"insertText": `enchant \${1|${entitySelectors}|} minecraft:\${2:enchantment} \${3:level}`,
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "/enchant <entity> <enchantment> [level]"
			}
		},
		{
			"label": "experience add",
			"detail": "Adds experience to a player",
			"kind": CompletionItemKind.Snippet,
			"filterText": "experience xp add",
			"insertText": `experience add \${1|${entitySelectors}|} \${2:amount} \${3|points,levels|}`,
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "/experience add <player> <amount> <points|levels>"
			}
		},
		{
			"label": "experience set",
			"detail": "Sets a player's experience",
			"kind": CompletionItemKind.Snippet,
			"filterText": "experience xp set",
			"insertText": `experience set \${1|${entitySelectors}|} \${2:amount} \${3|points,levels|}`,
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "/experience set <player> <amount> <points|levels>"
			}
		},
		{
			"label": "item replace entity",
			"detail": "Replaces an item in an entity's slot",
			"kind": CompletionItemKind.Snippet,
			"filterText": "item replace entity",
			"insertText": `item replace entity \${1|${entitySelectors}|} \${2:slot} with minecraft:\${3|${allMinecraftItems}|}`,
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "/item replace entity <entity> <slot> with <item>"
			}
		},
		{
			"label": "item replace block",
			"detail": "Replaces an item in a block's slot",
			"kind": CompletionItemKind.Snippet,
			"filterText": "item replace block",
			"insertText": `item replace block \${1:x} \${2:y} \${3:z} \${4:slot} with minecraft:\${5|${allMinecraftItems}|}`,
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "/item replace block <coordinates> <slot> with <item>"
			}
		},
		{
			"label": "particle",
			"detail": "Creates particles",
			"kind": CompletionItemKind.Snippet,
			"filterText": "particle",
			"insertText": `particle minecraft:\${1:particle} \${2:x} \${3:y} \${4:z} \${5:dx} \${6:dy} \${7:dz} \${8:speed} \${9:count} \${10|force,normal|}`,
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "/particle <particle> <coordinates> <delta> <speed> <count> [force|normal]"
			}
		},
		{
			"label": "playsound",
			"detail": "Plays a sound",
			"kind": CompletionItemKind.Snippet,
			"filterText": "playsound sound",
			"insertText": `playsound minecraft:\${1:sound} \${2|master,ambient,block,hostile,music,neutral,player,record,voice,weather|} \${3|${entitySelectors}|} \${4:x} \${5:y} \${6:z} \${7:volume} \${8:pitch}`,
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "/playsound <sound> <category> <player> <coordinates> <volume> <pitch>"
			}
		},
		{
			"label": "scoreboard objectives add",
			"detail": "Adds a scoreboard objective",
			"kind": CompletionItemKind.Snippet,
			"filterText": "scoreboard objectives add",
			"insertText": "scoreboard objectives add ${1:name} ${2:criteria}",
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "/scoreboard objectives add <name> <criteria>"
			}
		},
		{
			"label": "scoreboard objectives remove",
			"detail": "Removes a scoreboard objective",
			"kind": CompletionItemKind.Snippet,
			"filterText": "scoreboard objectives remove",
			"insertText": "scoreboard objectives remove ${1:name}",
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "/scoreboard objectives remove <name>"
			}
		},
		{
			"label": "scoreboard players set",
			"detail": "Sets a player's score",
			"kind": CompletionItemKind.Snippet,
			"filterText": "scoreboard players set",
			"insertText": `scoreboard players set \${1|${entitySelectors}|} \${2:objective} \${3:score}`,
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "/scoreboard players set <entity> <objective> <score>"
			}
		},
		{
			"label": "scoreboard players add",
			"detail": "Adds to a player's score",
			"kind": CompletionItemKind.Snippet,
			"filterText": "scoreboard players add",
			"insertText": `scoreboard players add \${1|${entitySelectors}|} \${2:objective} \${3:count}`,
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "/scoreboard players add <entity> <objective> <count>"
			}
		},
		{
			"label": "scoreboard players reset",
			"detail": "Resets a player's score",
			"kind": CompletionItemKind.Snippet,
			"filterText": "scoreboard players reset",
			"insertText": `scoreboard players reset \${1|${entitySelectors}|} \${2:objective}`,
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "/scoreboard players reset <entity> [objective]"
			}
		},
		{
			"label": "tellraw",
			"detail": "Sends a JSON text message to a player",
			"kind": CompletionItemKind.Snippet,
			"filterText": "tellraw",
			"insertText": `tellraw \${1|${entitySelectors}|} \${2:json}`,
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "/tellraw <player> <json>"
			}
		},
		{
			"label": "title",
			"detail": "Displays a title to a player",
			"kind": CompletionItemKind.Snippet,
			"filterText": "title",
			"insertText": `title \${1|${entitySelectors}|} \${2|title,subtitle,actionbar|} \${3:json}`,
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "/title <player> <title|subtitle|actionbar> <json>"
			}
		},
		{
			"label": "title times",
			"detail": "Sets title fade-in/stay/fade-out times",
			"kind": CompletionItemKind.Snippet,
			"filterText": "title times",
			"insertText": `title \${1|${entitySelectors}|} times \${2:fadeIn} \${3:stay} \${4:fadeOut}`,
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "/title <player> times <fadeIn> <stay> <fadeOut>"
			}
		},
		{
			"label": "title clear",
			"detail": "Clears the title from a player's screen",
			"kind": CompletionItemKind.Snippet,
			"filterText": "title clear",
			"insertText": `title \${1|${entitySelectors}|} \${2|clear,reset|}`,
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "/title <player> <clear|reset>"
			}
		},
		{
			"label": "attribute",
			"detail": "Queries, adds, removes or sets an entity attribute",
			"kind": CompletionItemKind.Text,
			"filterText": "attribute",
			"insertText": "attribute "
		},
		{
			"label": "bossbar",
			"detail": "Creates and modifies bossbars",
			"kind": CompletionItemKind.Text,
			"filterText": "bossbar",
			"insertText": "bossbar "
		},
		{
			"label": "damage",
			"detail": "Applies damage to the specified entities",
			"kind": CompletionItemKind.Text,
			"filterText": "damage",
			"insertText": "damage "
		},
		{
			"label": "data",
			"detail": "Gets, merges, modifies, and removes NBT data",
			"kind": CompletionItemKind.Text,
			"filterText": "data nbt",
			"insertText": "data "
		},
		{
			"label": "dialog",
			"detail": "Shows dialog to clients",
			"kind": CompletionItemKind.Text,
			"filterText": "dialog",
			"insertText": "dialog "
		},
		{
			"label": "execute",
			"detail": "Executes another command",
			"kind": CompletionItemKind.Text,
			"filterText": "execute",
			"insertText": "execute "
		},
		{
			"label": "fillbiome",
			"detail": "Fills a region with a specific biome",
			"kind": CompletionItemKind.Text,
			"filterText": "fillbiome biome",
			"insertText": "fillbiome "
		},
		{
			"label": "forceload",
			"detail": "Forces chunks to be loaded or not",
			"kind": CompletionItemKind.Text,
			"filterText": "forceload chunk",
			"insertText": "forceload "
		},
		{
			"label": "kill",
			"detail": "Kills entities",
			"kind": CompletionItemKind.Snippet,
			"filterText": "kill",
			"insertText": `kill \${1|${entitySelectors}|}`,
			"insertTextFormat": InsertTextFormat.Snippet,
			"documentation": {
				"kind": "plaintext",
				"value": "/kill <entity>"
			}
		},
		{
			"label": "loot",
			"detail": "Drops items from an inventory slot",
			"kind": CompletionItemKind.Text,
			"filterText": "loot",
			"insertText": "loot "
		},
		{
			"label": "place",
			"detail": "Places a feature, structure, or template",
			"kind": CompletionItemKind.Text,
			"filterText": "place",
			"insertText": "place "
		},
		{
			"label": "recipe",
			"detail": "Gives or takes player recipes",
			"kind": CompletionItemKind.Text,
			"filterText": "recipe",
			"insertText": "recipe "
		},
		{
			"label": "ride",
			"detail": "Makes entities ride other entities",
			"kind": CompletionItemKind.Text,
			"filterText": "ride mount",
			"insertText": "ride "
		},
		{
			"label": "rotate",
			"detail": "Changes entity rotation",
			"kind": CompletionItemKind.Text,
			"filterText": "rotate",
			"insertText": "rotate "
		},
		{
			"label": "spreadplayers",
			"detail": "Teleports entities randomly",
			"kind": CompletionItemKind.Text,
			"filterText": "spreadplayers",
			"insertText": "spreadplayers "
		},
		{
			"label": "stopsound",
			"detail": "Stops a sound",
			"kind": CompletionItemKind.Text,
			"filterText": "stopsound",
			"insertText": "stopsound "
		},
		{
			"label": "swing",
			"detail": "Swings the hands of an entity",
			"kind": CompletionItemKind.Text,
			"filterText": "swing",
			"insertText": "swing "
		},
		{
			"label": "team",
			"detail": "Controls teams",
			"kind": CompletionItemKind.Text,
			"filterText": "team",
			"insertText": "team "
		},
		{
			"label": "trigger",
			"detail": "Sets a trigger",
			"kind": CompletionItemKind.Text,
			"filterText": "trigger",
			"insertText": "trigger "
		},
		{
			"label": "waypoint",
			"detail": "Manages waypoints",
			"kind": CompletionItemKind.Text,
			"filterText": "waypoint",
			"insertText": "waypoint "
		}
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
// /teleport <#entityselector> [#entityselector]
// /teleport [#entityselector] <!fcoord> <!fcoord> <!fcoord>
// /tellraw [#playerselector] <!json>
// /title [#playerselector] <title|subtitle|actionbar> <!json>
// /title [#playerselector] <times> <!float> <!float> <!float>
// /title [#playerselector] <clear|reset>