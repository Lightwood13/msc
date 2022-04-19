/**
 * A single token representing one word or value in a command
 */
interface Token {
	/**
	 * Typing suggestions for this token
	 */
	suggestions: string[]
	/**
	 * Hash string to compare tokens for equality
	 * Required to avoid duplicate tokens in the tree
	 */
	hashString: string
	/**
	 * Tries to match this token in the given line starting from the given position
	 * @returns position after matched token on success, starting position on failure
	 */ 
	match: (line: string, pos: number) => number
}

/**
 * A node in the command tree
 */
class Node {
	token: Token
	children: Node[] = []
	
	constructor(token: Token) {
		this.token = token;
	}
}

/**
 * A dummy token used as the head of the tree
 */
const headToken: Token = {
	suggestions: [],
	hashString: 'head',
	match: (_line: string, pos: number): number => { return pos; }
};

/**
 * A token for representing errors while parsing command grammar
 */
const errorToken: Token = {
	suggestions: [],
	hashString: 'error',
	match: (_line: string, pos: number): number => { return pos; }
};

/**
 * Union of tokens.
 * Used when any of a few different tokens can be used in the same place
 */
class AlternativeToken implements Token {
	suggestions: string[]
	hashString: string
	match: (line: string, pos: number) => number

	constructor(tokens: Token[]) {
		this.suggestions = [];
		const hashStrings: string[] = [];
		for (const token of tokens) {
			for (const suggestion in token.suggestions) {
				if (this.suggestions.findIndex((s) => s === suggestion) === -1)
					this.suggestions.push(suggestion);
			}
			hashStrings.push(token.hashString);
		}
		hashStrings.sort();
		this.hashString = 'alt token:' + hashStrings.join(',');
		this.match = (line: string, pos: number): number => {
			for (const token of tokens) {
				const newPos = token.match(line, pos);
				if (newPos !== pos)
					return newPos;
			}
			return pos;
		};
	}
}

/**
 * Token representing one or several strings
 */
class TextToken implements Token {
	suggestions: string[]
	hashString: string
	match: (line: string, pos: number) => number

	constructor(options: string[], suggestions: string[]) {
		this.suggestions = suggestions;
		this.hashString = 'text array:' + options.join(',');
		this.match = (line: string, pos: number): number => {
			for (const option of options) {
				if (pos + option.length <= line.length && line.substring(pos, pos + option.length) === option)
					return pos + option.length;
			}
			
			return pos;
		};
	}
}

const entitySelectorToken: Token = {
	suggestions: ['@a', '@e', '@p', '@r', '@s', 'username'],
	hashString: 'entity selector',
	match: (line: string, pos: number): number => {
		if (pos === line.length)
			return pos;
		else if (line[pos] === '@' && pos + 1 < line.length && ['a', 'e', 'p', 'r', 's'].indexOf(line[pos + 1]) !== -1) {
			const startPos = pos;
			pos += 2;
			let bracketNumber = 0;
			while (pos < line.length) {
				if (line[pos] === '[')
					bracketNumber++;
				else if (line[pos] === ']')
					bracketNumber--;
				if (bracketNumber === 0)
					break;
				pos++;
			}
			if (bracketNumber !== 0)
				return startPos;
			else
				return pos;
		}
		// Username
		else if (/[a-zA-Z_]/.test(line[pos])) {
			while (pos < line.length && /[0-9a-zA-Z_-]/.test(line[pos])) {
				pos++;
			}
			return pos;
		}
		// UUID
		else if (/0-9/.test(line[pos])) {
			const startPos = pos;
			while (pos < line.length && /[0-9a-fA-F-]/.test(line[pos])) {
				pos++;
			}
			const uuid = line.substring(startPos, pos);
			if (uuid.split('-').length === 5)
				return pos;
			else
				return startPos;
		}
		else
			return pos;
	}
};

const coordToken: Token = {
	suggestions: ['~'],
	hashString: 'coord',
	match: (line: string, pos: number): number => {
		if (pos === line.length)
			return pos;

		const startPos = pos;

		if (line[pos] === '~')
			pos++;
		if (pos === line.length)
			return pos;
		
		if (line[pos] === '-')
			pos++;
		if (pos === line.length)
			return startPos;
		
		while (pos < line.length) {
			if (line[pos] === ' ') {
				break;
			} else if (/[0-9]/.test(line[pos])) {
				pos++;
				continue;
			} else {
				return startPos;
			}
		}

		return pos;
	}
};


const head: Node = new Node(headToken);
const errorNode: Node = new Node(errorToken);

function parseVariableToken(definition: string): Token {
	if (definition === "#entityselector")
		return entitySelectorToken;
	console.log('Parsing error');
	return errorToken;
}

function parseValueToken(definition: string): Token {
	if (definition === "!coord")
		return coordToken;
	return errorToken;
}

function parseNodeDefinition(definition: string): Node {
	const tokens: Token[] = [];
	const textTokens: string[] = [];
	for(const def of definition.split('|')) {
		if (def[0] === '!') {
			return new Node(parseValueToken(def));
		}
		else if (def[0] === '#') {
			return new Node(parseVariableToken(def));
		}
		else {
			textTokens.push(def);
		}
	}
	if (textTokens.length !== 0) {
		tokens.push(new TextToken(textTokens, textTokens));
	}

	if (tokens.length === 0) {
		console.log('Parsing error');
		return errorNode;
	}
	else if (tokens.length === 1) {
		return new Node(tokens[0]);
	}
	else {
		return new Node(new AlternativeToken(tokens));
	}
}

export function parseDefinitionLine(line: string) {
	let curNode: Node = head;
	
	let pos = 0;
	while (pos < line.length) {
		while (pos < line.length && line[pos] === ' ') {
			pos++;
		}

		if (pos === line.length)
			break;

		if (line[pos] === '<') {
			const startPos = pos;
			while (pos < line.length && line[pos] !== '>') {
				pos++;
			}

			if (pos === line.length)
				break;
			
			const newNode = parseNodeDefinition(line.substring(startPos + 1, pos));
			pos++;

			let newNodeFound = false;
			for (const child of curNode.children) {
				if (child.token.hashString === newNode.token.hashString) {
					newNodeFound = true;
					curNode = child;
					break;
				}
			}

			if (!newNodeFound) {
				curNode.children.push(newNode);
				curNode = newNode;
			}
		}
		else {
			console.log('Parsing error');
			break;
		}
	}

	console.log(head);
} 