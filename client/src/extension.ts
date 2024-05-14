/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

// imports needed
import * as path from 'path';
import {
	commands,
	window,
	env,
	workspace,
	ExtensionContext,
	Uri,
	Progress,
	ProgressLocation,
	CancellationToken,
	languages,
	TextEdit,
	TextDocument
} from 'vscode';
import axios from 'axios';
import * as https from 'https';
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node';

// creates a client for the extension
let client: LanguageClient;

// the interface for uploading a .msc or .nms file
interface UploadFileInfo {
	path: string,
	content: string,
	update: boolean // only update or do full upload (for .nms files)
}

interface IncludedFileInfo {
	fileName: string,
	startIndex: number,
	endIndexInclusive: number
}

interface NamespaceFunction {
	namespaceName: string,
	functionName: string
}

interface ClassConstructor {
	namespaceName: string,
	className: string,
	constructorSignature: string
}

interface ClassMethod {
	namespaceName: string,
	className: string,
	methodName: string
}

interface NamespaceUploadResult {
	name: string,
	namespaceDefinitionPath: string,
	defineScript: string,
	initializeScript: string,
	functions: NamespaceFunction[],
	constructors: ClassConstructor[],
	methods: ClassMethod[]
}

class ProcessedFileCache {

	// uploads without include substitution, so should be looked up only for included files
	// map path to link
	uploadedFiles: Map<string, string> = new Map();
	// map path to filenames or include names
	notFoundFiles: Map<string, Set<string>> = new Map();
	emptyFiles: Map<string, Set<string>> = new Map();
	failedUploads: Map<string, Set<string>> = new Map();

	// if the cache contains a file (by URI): only if it's in one of the four maps
	contains(uri: Uri): boolean {
		return this.uploadedFiles.has(uri.path) || this.notFoundFiles.has(uri.path) || this.emptyFiles.has(uri.path) || this.failedUploads.has(uri.path);
	}

	// adds a new filename to the map
	addNewFileName(uri: Uri, fileName: string) {
		if (this.notFoundFiles.has(uri.path)) {
			this.notFoundFiles.get(uri.path)?.add(fileName);
		}

		if (this.emptyFiles.has(uri.path)) {
			this.emptyFiles.get(uri.path)?.add(fileName);
		}

		if (this.failedUploads.has(uri.path)) {
			this.failedUploads.get(uri.path)?.add(fileName);
		}
	}
}

// gets a value from a map, returning & setting its value if it doesn't exist
function getOrDefault<K, V>(map: Map<K, V>, key: K, def: V): V {

	// if it exists, return the value
	const value = map.get(key);
	if (value !== undefined) {
		return value;

		// otherwise return the default value, having set it
	} else {
		map.set(key, def);
		return def;
	}
}

// replaces the part of a string from index startIndex to endIndexInclusive with the replacement
function replaceAt(str: string, startIndex: number, endIndexInclusive: number, replacement: string): string {
	return str.substring(0, startIndex) + replacement + str.substring(endIndexInclusive + 1);
}

// extract just the filename from the path of a file
function getFileNameFromPath(path: string): string {
	return path.substring(path.lastIndexOf('/') + 1);
}

// for temporary namespace identifiers, we use __ instead of :: in file paths
function escapeFunctionName(name: string): string {
	return name.replace(/::/g, '__');
}

// combines two file paths from the base to a specified file
function getIncludedFileUri(baseFileUri: Uri, includedFile: IncludedFileInfo): Uri {
	return Uri.joinPath(baseFileUri, '..', includedFile.fileName);
}

// gets the full list of filenames from a map (ie. our cache)
function getFileNameList(cache: Map<string, Set<string>>) {
	return [...cache.values()].flatMap(s => [...s.values()]).join(", ");
}

// gets all the specified files with the manual inclusion for import syntax
function collectIncludedFilesInfo(text: string): IncludedFileInfo[] {

	// the syntax to replace a filepath with an import (eg. <#namespace/script.msc>)
	const includeRegExp = /<#([^#][^\n]*?)>/g;

	// return all the matches of this syntax
	return [...text.matchAll(includeRegExp)].map((match) => {
		return {
			fileName: match[1],
			startIndex: match.index as number,
			endIndexInclusive: (match.index as number) + match[0].length - 1
		};
	});
}

// uploads a file to paste.minr.org and returns the link if successful
async function uploadFile(contents: string): Promise<string | null> {
	try {
		contents = contents.replace(/<##/g, '<#');

		// send a POST request to the API endpoint with the text provided as payload
		const data = await axios({
			httpsAgent: new https.Agent({
				rejectUnauthorized: false
			}),
			url: 'https://paste.minr.org/documents',
			method: 'POST',
			data: contents
		});

		// return the key formatted as a link, or return null if failed
		return 'https://paste.minr.org/' + data.data.key;
	} catch (error) {
		return null;
	}

}

// uploads file contents and stores result in cache
// doesn't check if file is already in cache:
// - for included files check should be done before this function
// - non-included files should not be looked up in cache because they need include substitution, and only non-substituted version is cached
async function uploadFileWithCache(uri: Uri, fileName: string, contents: string, cache: ProcessedFileCache): Promise<string | null> {
	const result = await uploadFile(contents);

	// if we failed, add to the failed uploads cache, otherwise add to the uploaded files cache
	if (result === null) {
		getOrDefault(cache.failedUploads, uri.path, new Set()).add(fileName);
	} else {
		cache.uploadedFiles.set(uri.path, result);
	}

	// return the key
	return result;
}

// gets the content of a file given its data
async function findFile(uri: Uri, fileName: string, cache: ProcessedFileCache, optionalFile = false): Promise<string | null> {
	let fileContents: string;

	try {
		fileContents = (await workspace.fs.readFile(uri)).toString();
	} catch (error) {

		// if it's non-optional, try add it to not-found-files cache
		if (!optionalFile) {
			getOrDefault(cache.notFoundFiles, uri.path, new Set()).add(fileName);
		}
		return null;
	}

	// if the file is empty / whitespace-only, add it as an empty file to the empty-files cache
	// this is because paste.minr.org will reject the request and upload will fail
	if (fileContents.trim().length === 0) {
		getOrDefault(cache.emptyFiles, uri.path, new Set()).add(fileName);
		return null;
	}

	return fileContents;
}

// doesn't do include substitutions
async function findAndUploadFile(uri: Uri, fileName: string, cache: ProcessedFileCache): Promise<string | null> {

	// if this file is already in cache, get the result from cache
	// and add its current filename to cache
	if (cache.contains(uri)) {
		cache.addNewFileName(uri, fileName);
		return cache.uploadedFiles.get(uri.path) || null;
	}

	// get the file contents: if null, then we can ignore
	const fileContents = await findFile(uri, fileName, cache);
	if (fileContents === null) {
		return null;
	}

	// calls the other, bigger method to get the link
	return await uploadFileWithCache(uri, fileName, fileContents, cache);
}

// upload all the files specified by <#syntax>
async function uploadIncludedFiles(
	baseFileUri: Uri,
	includedFiles: IncludedFileInfo[],
	cache: ProcessedFileCache,
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	incrementProgress: () => void = () => { }
) {
	// for each file, upload it and increment the task progress (notification)
	for (const includedFile of includedFiles) {
		const uri = getIncludedFileUri(baseFileUri, includedFile);
		await findAndUploadFile(uri, includedFile.fileName, cache);
		incrementProgress();
	}
}

// replaces specified inclusion files with their URLs
function replaceIncludedFiles(baseFileUri: Uri, contents: string, includedFiles: IncludedFileInfo[], cache: ProcessedFileCache): string {
	let indexDiff = 0;

	// for each included file, get its URL
	for (const includedFile of includedFiles) {
		const link = cache.uploadedFiles.get(getIncludedFileUri(baseFileUri, includedFile).path);
		if (link === undefined)
			continue;

		// replace the syntax specifier with the URL at the correct index
		contents = replaceAt(contents, includedFile.startIndex + indexDiff, includedFile.endIndexInclusive + indexDiff, link);
		indexDiff += link.length - (includedFile.endIndexInclusive - includedFile.startIndex + 1);
	}

	return contents;
}

async function uploadNamespaceChildFile(
	namespaceFolderUri: Uri,
	fileName: string,
	cache: ProcessedFileCache,
	onSuccess: (link: string) => void,
	incrementProgress: () => void,
	optionalFile = false
) {
	// escape the filename and produce a URI from it
	const escapedFileName = escapeFunctionName(fileName);
	const fileUri = Uri.joinPath(namespaceFolderUri, escapedFileName);

	// get the file contents from this URI
	const fileContents: string | null = await findFile(fileUri, escapedFileName, cache, optionalFile);

	// if the file is not found or it's empty, exit early and increment the counter
	if (fileContents === null) {
		incrementProgress();
		return;
	}

	// replace all included files in the script with their URLs
	const includedFiles = collectIncludedFilesInfo(fileContents);
	await uploadIncludedFiles(fileUri, includedFiles, cache);
	const replacedFileContents = replaceIncludedFiles(fileUri, fileContents, includedFiles, cache);

	// upload this new file, now that all links are in place, and increment the counter
	const functionLink: string | null = await uploadFileWithCache(fileUri, escapedFileName, replacedFileContents, cache);
	if (functionLink !== null) {
		onSuccess(functionLink);
	}
	incrementProgress();
}

// returns true if any errors are found
function showErrors(cache: ProcessedFileCache): boolean {
	let errorsFound = false;
	if (cache.notFoundFiles.size !== 0) {
		window.showErrorMessage('Failed to find files: ' + getFileNameList(cache.notFoundFiles));
		errorsFound = true;
	}
	if (cache.emptyFiles.size !== 0) {
		window.showErrorMessage('Cannot upload empty files: ' + getFileNameList(cache.emptyFiles));
		errorsFound = true;
	}
	if (cache.failedUploads.size !== 0) {
		window.showErrorMessage('Failed to upload files: ' + getFileNameList(cache.failedUploads));
		errorsFound = true;
	}
	return errorsFound;
}

function formatDocument(document: TextDocument): TextEdit[] {
	const edits: TextEdit[] = [];

	let indentLevel = 0;

	for (let i = 0; i < document.lineCount; i++) {
		const line = document.lineAt(i);
		const lineText = line.text.trim();

		if (lineText.startsWith("# ")) {
			continue;
		}

		let indentingHere = false;

		// Adjust indentation based on control structures
		if (lineText.startsWith('@if')) {
			indentLevel++;
			indentingHere = true;
		} else if (lineText.startsWith('@elseif') || lineText.startsWith('@else')) {
			indentingHere = true;
		} else if (lineText.startsWith('@fi')) {
			indentLevel--;
		} else if (lineText.startsWith('@for')) {
			indentLevel++;
			indentingHere = true;
		} else if (lineText.startsWith('@done')) {
			indentLevel--;
		}

		const thisLineIndent = 4 * (indentLevel - +(indentingHere));

		edits.push(TextEdit.replace(line.range, ' '.repeat(thisLineIndent) + lineText));
	}

	return edits;
}

// triggers on client activation
export function activate(context: ExtensionContext) {
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

	// VSC command to upload a script
	let disposable = commands.registerCommand('msc.upload', async () => {

		// gets the currently open script (terminates if nonexistent)
		const textEditor = window.activeTextEditor;
		if (textEditor === undefined) {
			window.showErrorMessage('No file open to upload');
			return;
		}

		// if it's a namespace file, send notification to server to start namespace export
		if (textEditor.document.languageId === 'nms') {
			const fileInfo: UploadFileInfo = {
				path: textEditor.document.uri.path,
				content: textEditor.document.getText(),
				update: false
			};
			client.sendNotification('Export namespace', fileInfo);

			// otherwise, it's a normal script to upload
		} else {

			// if it's an empty file, ignore
			const text: string = textEditor.document.getText();
			if (text.trim().length === 0) {
				window.showErrorMessage('Cannot upload empty file');
				return;
			}

			// all manually included files with <#syntax>, and the link for this file
			const includedFilesInfo = collectIncludedFilesInfo(text);
			let link: string | null = null;

			// if we don't have manually included files, just upload current file
			if (includedFilesInfo.length === 0) {
				link = await uploadFile(text);

				if (link === null) {
					window.showErrorMessage('Failed to upload file');
				}
			} else {

				// if we have included files, show the progress notification for uploads
				link = await window.withProgress<string | null>({
					title: `Uploading ${getFileNameFromPath(textEditor.document.uri.path)}`,
					cancellable: false,
					location: ProgressLocation.Notification
				}, async (progress: Progress<{
					increment?: number,
					message?: string
				}>, _token: CancellationToken): Promise<string | null> => {

					// must upload all manually included files, plus current file itself
					const fileCount = includedFilesInfo.length + 1;
					const cache = new ProcessedFileCache();

					// start the progress counter
					progress.report({
						increment: 0,
						message: '0%'
					});

					// for each file, increment the index, and report the appropriate progress level
					let index = 0;
					await uploadIncludedFiles(textEditor.document.uri, includedFilesInfo, cache, () => {
						index++;
						progress.report({
							increment: 100 / fileCount,
							message: (index / fileCount * 100).toFixed(0) + '%'
						});
					});

					// if something went wrong (eg. missing file), stop here
					if (showErrors(cache)) {
						return null;
					}

					// otherwise replace all links and upload current file
					const replacedText = replaceIncludedFiles(textEditor.document.uri, text, includedFilesInfo, cache);
					const result = await uploadFile(replacedText);

					// now completed, so send progress complete message
					progress.report({
						increment: 100 / fileCount,
						message: '100%'
					});

					// error or return successful link
					if (result === null) {
						window.showErrorMessage('Failed to upload file');
					}
					return result;
				});
			}

			// if we have a link, write it to the clipboard and display a success message
			if (link !== null) {
				env.clipboard.writeText(link);
				window.showInformationMessage('Upload finished. Script url was copied to clipboard');
			}
		}
	});
	context.subscriptions.push(disposable);

	// updates a namespace without removing it
	disposable = commands.registerCommand('msc.update_nms', () => {

		// gets the currently open script (terminates if nonexistent)
		const textEditor = window.activeTextEditor;
		if (textEditor === undefined) {
			window.showErrorMessage('No file open to upload');
			return;
		}

		// if it's a namespace file, upload it with update = true
		if (textEditor.document.languageId === 'nms') {
			const fileInfo: UploadFileInfo = {
				path: textEditor.document.uri.path,
				content: textEditor.document.getText(),
				update: true
			};
			client.sendNotification('Export namespace', fileInfo);
		}
		// otherwise ignore
		else {
			window.showErrorMessage('Can only update .nms files');
		}
	});
	context.subscriptions.push(disposable);



	// download a document from the clipboard
	disposable = commands.registerCommand('msc.download', async () => {

		// gets text from clipboard and verifies it's nonempty
		const clipboardText = await env.clipboard.readText();
		if (clipboardText.length === 0) {
			window.showErrorMessage('Clipboard is empty. Please copy script url to clipboard');
			return;
		}

		// match paste.minr.org links
		const regex = /^(?:(?:https:\/\/)?paste\.minr\.org\/)?([a-zA-Z]{10})$/;
		const match = clipboardText.trim().match(regex);
		let scriptName = '';

		// extract the link part of it
		if (match) {
			scriptName = match[1];
		} else {
			window.showErrorMessage('Please copy a valid script URL to clipboard');
			return;
		}

		// get the script from paste.minr.org
		axios({
			httpsAgent: new https.Agent({
				rejectUnauthorized: false
			}),
			url: 'https://paste.minr.org/documents/' + scriptName,
			method: 'GET',
		})

			// then make a new editor window with this text
			.then(async data => {
				await workspace.openTextDocument({
					'language': 'msc',
					'content': data.data.data
				});
			})
			// if errored, then display an error message
			.catch(_err => {
				window.showErrorMessage('Cannot get requested script. Please copy a valid script URL to clipboard');
			});
	});
	context.subscriptions.push(disposable);

	// the server is implemented in node
	const serverModule = context.asAbsolutePath(
		path.join('server', 'out', 'server.js')
	);

	// the debug options for the server
	// --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
	const debugOptions = {
		execArgv: ['--nolazy', '--inspect=6009']
	};

	// if the extension is launched in debug mode then the debug server options are used
	// otherwise the run options are used
	const serverOptions: ServerOptions = {
		run: {
			module: serverModule,
			transport: TransportKind.ipc
		},
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: debugOptions
		}
	};

	// options to control the language client
	const clientOptions: LanguageClientOptions = {
		documentSelector: [{
			language: 'msc'
		}],
		synchronize: {
			// notify the server about file changes to '.nms' files contained in the workspace
			// to update code suggestions
			fileEvents: workspace.createFileSystemWatcher('**/*.nms')
		}
	};

	// create the language client and start it
	client = new LanguageClient(
		'languageServerExample',
		'Language Server Example',
		serverOptions,
		clientOptions
	);

	// start the client, also launching the server
	client.start();

	// when the client is ready, get the default namespace from github
	client.onReady().then(() => {
		client.onNotification('getDefaultNamespaces', () => {
			axios({
				httpsAgent: new https.Agent({
					rejectUnauthorized: false
				}),
				url: 'https://raw.githubusercontent.com/Lightwood13/msc/master/resources/default.nms',
				method: 'GET',
			})
				// success: send notification to server to start processing received default namespaces
				.then(data => {
					console.log('Successfully fetched default namespaces file from GitHub');
					client.sendNotification('processDefaultNamespaces', data.data);
				})
				// if this fails, get default namespaces from extension resources and send it to server for processing
				.catch(_err => {
					console.log('Couldn\'t connect to GitHub');
					const defaultNamespacesUri = Uri.joinPath(context.extensionUri, 'resources', 'default.nms');
					workspace.fs.readFile(defaultNamespacesUri).then((result) => {
						client.sendNotification('processDefaultNamespaces', result.toString());
					});
				});
		});

		// the logic behind uploading namespaces
		client.onNotification('Upload namespace script', async (namespaces: NamespaceUploadResult[]) => {

			// if no namespace to upload, then exit
			if (namespaces.length === 0) {
				window.showErrorMessage("Couldn't parse any namespaces");
				return;
			}

			// builds the script from scratch, adding for each namespace in the file
			let finalScript: string | null = '';
			for (const namespaceInfo of namespaces) {

				// send the user a notification tracking the upload progress
				const script = await window.withProgress<string | null>({
					title: `Uploading namespace ${namespaceInfo.name}`,
					cancellable: false,
					location: ProgressLocation.Notification
				}, async (progress: Progress<{
					increment?: number,
					message?: string
				}>, _token: CancellationToken): Promise<string | null> => {

					// lines needed to import and their count: +1 for __init__.msc
					const importLines: string[] = [];
					const totalUploadNumber = namespaceInfo.functions.length + namespaceInfo.constructors.length + namespaceInfo.methods.length + 1;
					let currentUploadNumber = 0;

					// for uploading
					const namespaceFolderUri: Uri = Uri.joinPath(Uri.file(namespaceInfo.namespaceDefinitionPath), '..', namespaceInfo.name);
					const cache = new ProcessedFileCache();

					progress.report({
						increment: 0,
						message: '0%'
					});

					// function to increment progress notification by one file
					const incrementProgress = () => {
						currentUploadNumber += 1;
						progress.report({
							increment: 100 / totalUploadNumber,
							message: (currentUploadNumber / totalUploadNumber * 100).toFixed(0) + '%'
						});
					};

					// for each function, add the line to import its script
					for (const functionInfo of namespaceInfo.functions) {
						await uploadNamespaceChildFile(
							namespaceFolderUri, `${functionInfo.functionName}.msc`, cache,
							functionLink => {
								importLines.push(`@bypass /script import function ${functionInfo.namespaceName} ${functionInfo.functionName} ${functionLink}`);
							}, incrementProgress
						);
					}

					// for each constructor
					for (const constructorInfo of namespaceInfo.constructors) {
						await uploadNamespaceChildFile(
							namespaceFolderUri, `${constructorInfo.className}/${constructorInfo.constructorSignature}.msc`, cache,
							constructorLink => {
								importLines.push(`@bypass /script import constructor ${constructorInfo.namespaceName} ${constructorInfo.constructorSignature} ${constructorLink}`);
							}, incrementProgress
						);
					}

					// for each method
					for (const methodInfo of namespaceInfo.methods) {
						await uploadNamespaceChildFile(
							namespaceFolderUri, `${methodInfo.className}/${methodInfo.methodName}.msc`, cache,
							methodLink => {
								importLines.push(`@bypass /script import method ${methodInfo.namespaceName} ${methodInfo.className} ${methodInfo.methodName} ${methodLink}`);
							}, incrementProgress
						);
					}

					// namespace init function
					await uploadNamespaceChildFile(
						namespaceFolderUri, `__init__.msc`, cache,
						initLink => {
							namespaceInfo.defineScript += '\n' + `# Namespace initialisation function from ${namespaceInfo.name}/__init__.msc` +
								'\n' + `@bypass /function define ${namespaceInfo.name} wilexafixu()`;
							importLines.push(`@bypass /script import function ${namespaceInfo.name} wilexafixu ${initLink}`);
							namespaceInfo.initializeScript += '\n\n' + '@player &7[&#20a0d0VSCode&7] &eExecuting namespace initialisation function.' +
								'\n' + `@bypass /function execute ${namespaceInfo.name}::wilexafixu()` +
								'\n' + `@bypass /function remove ${namespaceInfo.name} wilexafixu`;
						}, incrementProgress, true
					);

					// if something has gone wrong, exit
					if (showErrors(cache)) {
						return null;
					}

					// let the script be blank, and build it up from scratch
					let script: string = (namespaceInfo.defineScript !== '') ?
						`@player &7[&#20a0d0VSCode&7] &eNow importing namespace ${namespaceInfo.name}.` +
						'\n\n' + namespaceInfo.defineScript :
						`@player &7[&#20a0d0VSCode&7] &eNow updating namespace ${namespaceInfo.name}.`;

					// if we have at least one import line, add all of them to the script
					if (importLines.length !== 0) {
						script += '\n\n' + importLines.join('\n');
					}

					// if the namespace variables initialiser is not blank, then add it to the script
					// if it has any function calls in it, wait for 3 seconds for all function imports to finish
					if (namespaceInfo.initializeScript !== '') {
						script
							+= '\n\n' +
							(namespaceInfo.initializeScript.indexOf('(') !== -1 ? '\n@player &7[&#20a0d0VSCode&7] &eNow setting variables.\n@delay 3s\n' : '') +
							namespaceInfo.initializeScript;
					}
					return script;
				});

				// if the script upload failed, abort remaining uploads and exit
				if (script === null) {
					finalScript = null;
					break;
				}

				// line breaks between each namespace
				finalScript += script + '\n\n\n';
			}

			// if upload failed, exit
			if (finalScript === null) return;

			// removes the script from the block it was on, and notifies the player in chat
			finalScript += '@bypass /script remove interact {{block.getX()}} {{block.getY()}} {{block.getZ()}}';
			finalScript += '\n' + '@player &7[&#20a0d0VSCode&7] &aNamespace import finished!';

			// uploads this script
			const finalLink: string | null = await uploadFile(finalScript);
			if (finalLink === null) {
				window.showErrorMessage('Failed to upload script');
				return;
			}

			// copies the upload link to clipboard and notifies the user
			env.clipboard.writeText(finalLink);
			if (namespaces[0].defineScript !== '') {
				window.showInformationMessage('Namespace upload finished. Script URL copied to clipboard.');
			} else {
				window.showInformationMessage('Namespace update finished. Script URL copied to clipboard.');
			}
		});
	});

	// register the formatter
	context.subscriptions.push(
		languages.registerDocumentFormattingEditProvider(
			'msc',
			{
				provideDocumentFormattingEdits(document: TextDocument): TextEdit[] {
					return formatDocument(document);
				}
			}
		)
	);
}

// when we finish, deactivate and stop the client
export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
