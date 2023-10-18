/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

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
	CancellationToken
} from 'vscode';
import axios from 'axios';
import * as https from 'https';
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient;

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
	// map path to link
	// uploads without include substitution, so should be looked up only for included files
	uploadedFiles: Map<string, string> = new Map();
	// map path to filenames or include names
	notFoundFiles: Map<string, Set<string>> = new Map();
	emptyFiles: Map<string, Set<string>> = new Map();
	failedUploads: Map<string, Set<string>> = new Map();

	contains(uri: Uri): boolean {
		return this.uploadedFiles.has(uri.path) || this.notFoundFiles.has(uri.path) || this.emptyFiles.has(uri.path) || this.failedUploads.has(uri.path);
	}

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

function getOrDefault<K, V>(map: Map<K, V>, key: K, def: V): V {
	const value = map.get(key);
	if (value !== undefined) {
		return value;
	} else {
		map.set(key, def);
		return def;
	}
}

function replaceAt(str: string, startIndex: number, endIndexInclusive: number, replacement: string): string {
    return str.substring(0, startIndex) + replacement + str.substring(endIndexInclusive + 1);
}

function getFileNameFromPath(path: string): string {
	return path.substring(path.lastIndexOf('/') + 1);
}

function escapeFunctionName(name: string): string {
	return name.replace(/::/g, '__');
}

function getIncludedFileUri(baseFileUri: Uri, includedFile: IncludedFileInfo): Uri {
	return Uri.joinPath(baseFileUri, '..', includedFile.fileName);
}

function getFileNameList(cache: Map<string, Set<string>>) {
	return [...cache.values()].flatMap(s => [...s.values()]).join(", ");
}

const includeRegExp = /<#([^#][^\n]*?)>/g;

function collectIncludedFilesInfo(text: string): IncludedFileInfo[] {
	return [...text.matchAll(includeRegExp)].map((match) => {
		return {
			fileName: match[1],
			startIndex: match.index as number,
			endIndexInclusive: (match.index as number) + match[0].length - 1
		};
	});
}

async function uploadFile(contents: string): Promise<string | null> {
	try {
		contents = contents.replace(/<##/g, '<#');
		const data = await axios({
			httpsAgent: new https.Agent({
				rejectUnauthorized: false
			}),
			url: 'https://paste.minr.org/documents',
			method: 'POST',
			data: contents
		});
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

	if (result === null) {
		getOrDefault(cache.failedUploads, uri.path, new Set()).add(fileName);
	} else {
		cache.uploadedFiles.set(uri.path, result);
	}

	return result;
}

async function findFile(uri: Uri, fileName: string, cache: ProcessedFileCache, optionalFile = false): Promise<string | null> {
	let fileContents: string;
	try {
		fileContents = (await workspace.fs.readFile(uri)).toString();
	} catch (error) {
		if (!optionalFile) {
			getOrDefault(cache.notFoundFiles, uri.path, new Set()).add(fileName);
		}
		return null;
	}

	if (fileContents.trim().length === 0) {
		getOrDefault(cache.emptyFiles, uri.path, new Set()).add(fileName);
		return null;
	}

	return fileContents;
}

// doesn't do include substitutions
async function findAndUploadFile(uri: Uri, fileName: string, cache: ProcessedFileCache): Promise<string | null> {
	if (cache.contains(uri)) {
		cache.addNewFileName(uri, fileName);
		return cache.uploadedFiles.get(uri.path) || null;
	}

	const fileContents = await findFile(uri, fileName, cache);

	if (fileContents === null) {
		return null;
	}

	return await uploadFileWithCache(uri, fileName, fileContents, cache);
}

async function uploadIncludedFiles(
	baseFileUri: Uri,
	includedFiles: IncludedFileInfo[],
	cache: ProcessedFileCache,
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	incrementProgress: () => void = () => {}
) {
	for (const includedFile of includedFiles) {
		const uri = getIncludedFileUri(baseFileUri, includedFile);
		await findAndUploadFile(uri, includedFile.fileName, cache);
		incrementProgress();
	}
}

function replaceIncludedFiles(baseFileUri: Uri, contents: string, includedFiles: IncludedFileInfo[], cache: ProcessedFileCache): string {
	let indexDiff = 0;
	for (const includedFile of includedFiles) {
		const link = cache.uploadedFiles.get(getIncludedFileUri(baseFileUri, includedFile).path);
		if (link === undefined)
			continue;

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
	const escapedFileName = escapeFunctionName(fileName);
	const fileUri = Uri.joinPath(namespaceFolderUri, escapedFileName);

	const fileContents: string | null = await findFile(fileUri, escapedFileName, cache, optionalFile);
	if (fileContents === null) {
		incrementProgress();
		return;
	}

	const includedFiles = collectIncludedFilesInfo(fileContents);
	await uploadIncludedFiles(fileUri, includedFiles, cache);
	const replacedFileContents = replaceIncludedFiles(fileUri, fileContents, includedFiles, cache);

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

export function activate(context: ExtensionContext) {
	
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
	
	let disposable = commands.registerCommand('msc.upload', async () => {

		const textEditor = window.activeTextEditor;
		
		if (textEditor === undefined)
		{
			window.showErrorMessage('No file open to upload');
			return;
		}

		if (textEditor.document.languageId === 'nms') {
			const fileInfo: UploadFileInfo = {
				path: textEditor.document.uri.path,
				content: textEditor.document.getText(),
				update: false
			};
			client.sendNotification('Export namespace', fileInfo);
		}
		else {
			const text: string = textEditor.document.getText();
			if (text.trim().length === 0) {
				window.showErrorMessage('Cannot upload empty file');
				return;
			}

			const includedFilesInfo = collectIncludedFilesInfo(text);

			let link: string | null = null;

			if (includedFilesInfo.length === 0) {
				link = await uploadFile(text);
				if (link === null) {
					window.showErrorMessage('Failed to upload file');
				}
			} 
			else {	
				link = await window.withProgress<string | null>({
					title: `Uploading ${getFileNameFromPath(textEditor.document.uri.path)}`,
					cancellable: false,
					location: ProgressLocation.Notification
				}, async (progress: Progress<{increment?: number, message?: string}>, _token: CancellationToken): Promise<string | null> => {
					
					const fileCount = includedFilesInfo.length + 1;

					const cache = new ProcessedFileCache();

					progress.report({increment: 0, message: '0%'});

					let index = 0;
					await uploadIncludedFiles(textEditor.document.uri, includedFilesInfo, cache, () => {
						index++;
						progress.report({increment: 100/fileCount, message: (index/fileCount*100).toFixed(0) + '%'});
					});

					if (showErrors(cache)) {
						return null;
					}

					const replacedText = replaceIncludedFiles(textEditor.document.uri, text, includedFilesInfo, cache);
					const result = await uploadFile(replacedText);

					progress.report({increment: 100/fileCount, message: '100%'});
	
					if (result === null) {
						window.showErrorMessage('Failed to upload file');
					}

					return result;
				});
			}
			
			if (link !== null) {
				env.clipboard.writeText(link);
				window.showInformationMessage('Upload finished. Script url was copied to clipboard');
			}
		}
	});
	context.subscriptions.push(disposable);

	disposable = commands.registerCommand('msc.update_nms', () => {

		const textEditor = window.activeTextEditor;
		
		if (textEditor === undefined)
		{
			window.showErrorMessage('No file open to upload');
			return;
		}

		if (textEditor.document.languageId === 'nms') {
			const fileInfo: UploadFileInfo = {
				path: textEditor.document.uri.path,
				content: textEditor.document.getText(),
				update: true
			};
			client.sendNotification('Export namespace', fileInfo);
		}
		else {
			window.showErrorMessage('Can only update .nms files');
		}
	});
	context.subscriptions.push(disposable);

	disposable = commands.registerCommand('msc.download', async () => {

		const clipboardText = await env.clipboard.readText();
		if (clipboardText.length === 0)
		{
			window.showErrorMessage('Clipboard is empty. Please copy script url to clipboard');
			return;
		}
		
		const scriptName = clipboardText.substring(23);
		if (scriptName.length === 0)
		{
			window.showErrorMessage('Please copy a valid script URL to clipboard');
			return;
		}
		axios({
			httpsAgent: new https.Agent({
				rejectUnauthorized: false
			}),
			url: 'https://paste.minr.org/documents/' + scriptName,
			method: 'GET',
		})
		.then(async data => {
			await workspace.openTextDocument({'language': 'msc', 'content': data.data.data});
		})
		.catch(_err => {
			window.showErrorMessage('Cannot get requested script. Please copy a valid script URL to clipboard');
		});
	});
	context.subscriptions.push(disposable);

	// The server is implemented in node
	const serverModule = context.asAbsolutePath(
		path.join('server', 'out', 'server.js')
	);
	// The debug options for the server
	// --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
	const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

	// If the extension is launched in debug mode then the debug server options are used
	// Otherwise the run options are used
	const serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: debugOptions
		}
	};

	// Options to control the language client
	const clientOptions: LanguageClientOptions = {
		documentSelector: [{ language: 'msc' }],
		synchronize: {
			// Notify the server about file changes to '.nms files contained in the workspace
			fileEvents: workspace.createFileSystemWatcher('**/*.nms')
		}
	};

	// Create the language client and start the client.
	client = new LanguageClient(
		'languageServerExample',
		'Language Server Example',
		serverOptions,
		clientOptions
	);

	// Start the client. This will also launch the server
	client.start();

	client.onReady().then(() => {
		client.onNotification('getDefaultNamespaces', () => {
			axios({
				httpsAgent: new https.Agent({
					rejectUnauthorized: false
				}),
				url: 'https://raw.githubusercontent.com/Lightwood13/msc/master/resources/default.nms',
				method: 'GET',
			})
			.then(data => {
				console.log('Successfully fetched default namespaces file from github');
				client.sendNotification('processDefaultNamespaces', data.data);
			})
			.catch(_err => {
				console.log('Couldn\'t connect to github');
				const defaultNamespacesUri = Uri.joinPath(context.extensionUri, 'resources', 'default.nms');
				workspace.fs.readFile(defaultNamespacesUri).then((result) => {
					client.sendNotification('processDefaultNamespaces', result.toString());
				});
			});
		});
		client.onNotification('Upload namespace script', async (namespaces: NamespaceUploadResult[]) => {
			if (namespaces.length === 0) {
				window.showErrorMessage("Couldn't parse any namespaces");
				return;
			}
			let finalScript: string | null = '';
			for (const namespaceInfo of namespaces) {
				const script = await window.withProgress<string | null>({
					title: `Uploading namespace ${namespaceInfo.name}`,
					cancellable: false,
					location: ProgressLocation.Notification
				}, async (progress: Progress<{increment?: number, message?: string}>, _token: CancellationToken): Promise<string | null> => {	
					
					const importLines: string[] = [];
	
					// +1 for __init__.msc
					const totalUploadNumber = namespaceInfo.functions.length + namespaceInfo.constructors.length + namespaceInfo.methods.length + 1;
					let currentUploadNumber = 0;

					const namespaceFolderUri: Uri = Uri.joinPath(Uri.file(namespaceInfo.namespaceDefinitionPath), '..', namespaceInfo.name);

					const cache = new ProcessedFileCache();	
	
					if (totalUploadNumber !== 0)
						progress.report({increment: 0, message: '0%'});

					const incrementProgress = () => {
						currentUploadNumber += 1;
						progress.report({increment: 100/totalUploadNumber, message: (currentUploadNumber/totalUploadNumber*100).toFixed(0) + '%'});	
					};
	
					for (const functionInfo of namespaceInfo.functions) {
						await uploadNamespaceChildFile(
							namespaceFolderUri, `${functionInfo.functionName}.msc`, cache,
							functionLink => {
								importLines.push(`@bypass /script import function ${functionInfo.namespaceName} ${functionInfo.functionName} ${functionLink}`);
							}, incrementProgress
						);	
					}
					for (const constructorInfo of namespaceInfo.constructors) {
						await uploadNamespaceChildFile(
							namespaceFolderUri, `${constructorInfo.className}/${constructorInfo.constructorSignature}.msc`, cache,
							constructorLink => {
								importLines.push(`@bypass /script import constructor ${constructorInfo.namespaceName} ${constructorInfo.constructorSignature} ${constructorLink}`);
							}, incrementProgress
						);
					}
					for (const methodInfo of namespaceInfo.methods) {
						await uploadNamespaceChildFile(
							namespaceFolderUri, `${methodInfo.className}/${methodInfo.methodName}.msc`, cache,
							methodLink => {
								importLines.push(`@bypass /script import method ${methodInfo.namespaceName} ${methodInfo.className} ${methodInfo.methodName} ${methodLink}`);
							}, incrementProgress
						);
					}

					await uploadNamespaceChildFile(
						namespaceFolderUri, `__init__.msc`, cache,
						initLink => {
							namespaceInfo.defineScript
								+= '\n' + '# namespace init function'
								+ '\n' + `@bypass /function define ${namespaceInfo.name} wilexafixu()`;
							importLines.push(`@bypass /script import function ${namespaceInfo.name} wilexafixu ${initLink}`);
							namespaceInfo.initializeScript
								+= '\n\n' + '@player &aExecuting namespace init function'
								+ '\n' + `@bypass /function execute ${namespaceInfo.name}::wilexafixu()`
								+ '\n' + `@bypass /function remove ${namespaceInfo.name} wilexafixu`;
						}, incrementProgress, true
					);

					if (showErrors(cache)) {
						return null;
					}
					
					let script: string = (namespaceInfo.defineScript !== '') ? 
						`@player &aImporting namespace ${namespaceInfo.name}` 
						+ '\n\n' + namespaceInfo.defineScript : 
						`@player &aUpdating namespace ${namespaceInfo.name}`;
					if (importLines.length !== 0) {
						script += '\n\n' + importLines.join('\n');
					}
					if (namespaceInfo.initializeScript !== '') {
						script
							+= '\n\n'
							+ (namespaceInfo.initializeScript.indexOf('(') !== -1 ? '@delay 3s\n' : '')
							+ namespaceInfo.initializeScript;
					}
					return script;
				});

				if (script === null) {
					finalScript = null;
					break;
				}

				finalScript += script;
				finalScript += '\n\n\n';
			}

			if (finalScript === null) return;

			finalScript += '@bypass /script remove interact {{block.getX()}} {{block.getY()}} {{block.getZ()}}';
			finalScript += '\n' + '@player &aNamespace import finished';
			const finalLink: string | null = await uploadFile(finalScript);
			if (finalLink === null) {
				window.showErrorMessage('Failed to upload script');
				return;
			}

			env.clipboard.writeText(finalLink);
			if (namespaces[0].defineScript !== '') {
				window.showInformationMessage('Upload finished. Script url was copied to clipboard');
			}
			else {
				window.showInformationMessage('Finished uploading namespace update. Script url was copied to clipboard');
			}
		});
	});
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
