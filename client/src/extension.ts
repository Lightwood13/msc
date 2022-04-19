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
	defineScript: string,
	initializeScript: string,
	functions: NamespaceFunction[],
	constructors: ClassConstructor[],
	methods: ClassMethod[]
}

async function uploadFile(text: string): Promise<string> {
	const data = await axios({
		httpsAgent: new https.Agent({
			rejectUnauthorized: false
		}),
		url: 'https://paste.minr.org/documents',
		method: 'POST',
		data: text
	});
	return 'https://paste.minr.org/' + data.data.key;
}

async function findAndUploadFile(fileName: string): Promise<string | Error> {
	const files: Uri[] = await workspace.findFiles(escapeArrayAccess(fileName));
	if (files.length === 0)
		return Error('File not found');
	const fileContents: string = (await workspace.fs.readFile(files[0])).toString();
	if (fileContents.trim().length === 0)
		return Error('Empty file');
	return await uploadFile(fileContents);
}

function escapeArrayAccess(text: string): string {
	const temp = text.replace(/\[\]/g, '[[][]]');
	return temp.replace(/::/g, '__');
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
			client.sendNotification('Export namespace', textEditor.document.getText());
		}
		else {
			const text: string = textEditor.document.getText();
			if (text.trim().length === 0) {
				window.showErrorMessage('Cannot upload empty file');
			}
			else {
				const result: string = await uploadFile(text);
				env.clipboard.writeText(result);
				window.showInformationMessage('Upload finished. Script url was copied to clipboard');
			}
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
		client.onNotification('getDefaultNamespace', () => {
			axios({
				httpsAgent: new https.Agent({
					rejectUnauthorized: false
				}),
				url: 'https://raw.githubusercontent.com/Lightwood13/msc/master/resources/default.nms',
				method: 'GET',
			})
			.then(async data => {
				console.log('Successfully fetched default namespace file from github');
				client.sendNotification('processDefaultNamespace', data.data);
			})
			.catch(_err => {
				console.log('Couldn\'t connect to github');
				const defaultNamespaceUri = Uri.joinPath(context.extensionUri, 'resources', 'default.nms');
				workspace.fs.readFile(defaultNamespaceUri).then((result) => {
					client.sendNotification('processDefaultNamespace', result.toString());
				});
			});
		});
		client.onNotification('Upload namespace script', async (namespaces: NamespaceUploadResult[]) => {
			if (namespaces.length === 0) {
				window.showErrorMessage("Couldn't parse any namespaces");
				return;
			}
			const scripts: Thenable<string>[] = [];
			for (const namespaceInfo of namespaces) {
				scripts.push(
					window.withProgress<string>({
						title: `Uploading namespace ${namespaceInfo.name}`,
						cancellable: false,
						location: ProgressLocation.Notification
					}, async (progress: Progress<{increment?: number, message?: string}>, _token: CancellationToken): Promise<string> => {	
						const importLines: string[] = [];
		
						const totalUploadNumber = namespaceInfo.functions.length + namespaceInfo.constructors.length + namespaceInfo.methods.length;
						let currentUploadNumber = 0;
						const failedUploads: string[] = [];
						const emptyFiles: string[] = [];
		
						if (totalUploadNumber !== 0)
							progress.report({increment: 0, message: '0%'});
		
						for (const functionInfo of namespaceInfo.functions) {
							const fileName = `${functionInfo.namespaceName}/${functionInfo.functionName}.msc`;
							const functionLink: string | Error = await findAndUploadFile(fileName);
							if (typeof functionLink === 'string') {
								importLines.push(`@bypass /script import function ${functionInfo.namespaceName} ${functionInfo.functionName} ${functionLink}`);
							} else if ((functionLink instanceof Error) && (functionLink.message === 'Empty file')) {
								emptyFiles.push(fileName);
							} else {
								failedUploads.push(fileName);
							}
							currentUploadNumber += 1;
							progress.report({increment: 100/totalUploadNumber, message: (currentUploadNumber/totalUploadNumber*100).toFixed(0) + '%'});
						}
						for (const constructorInfo of namespaceInfo.constructors) {
							const fileName = `${constructorInfo.namespaceName}/${constructorInfo.className}/${constructorInfo.constructorSignature}.msc`;
							const constructorLink: string | Error = await findAndUploadFile(fileName);
							if (typeof constructorLink === 'string') {
								importLines.push(`@bypass /script import constructor ${constructorInfo.namespaceName} ${constructorInfo.constructorSignature} ${constructorLink}`);
							} else if ((constructorLink instanceof Error) && (constructorLink.message === 'Empty file')) {
								emptyFiles.push(fileName);
							} else {
								failedUploads.push(fileName);
							}
							currentUploadNumber += 1;
							progress.report({increment: 100/totalUploadNumber, message: (currentUploadNumber/totalUploadNumber*100).toFixed(0) + '%'});
						}
						for (const methodInfo of namespaceInfo.methods) {
							const fileName = `${methodInfo.namespaceName}/${methodInfo.className}/${methodInfo.methodName}.msc`;
							const methodLink: string | Error = await findAndUploadFile(fileName);
							if (typeof methodLink === 'string') {
								importLines.push(`@bypass /script import method ${methodInfo.namespaceName} ${methodInfo.className} ${methodInfo.methodName} ${methodLink}`);
							} else if ((methodLink instanceof Error) && (methodLink.message === 'Empty file')) {
								emptyFiles.push(fileName);
							} else {
								failedUploads.push(fileName);
							}
							currentUploadNumber += 1;
							progress.report({increment: 100/totalUploadNumber, message: (currentUploadNumber/totalUploadNumber*100).toFixed(0) + '%'});
						}
		
						const initLink: string | Error = await findAndUploadFile(`${namespaceInfo.name}/__init__.msc`);
						if (typeof initLink === 'string') {
							namespaceInfo.defineScript
								+= '\n' + '# namespace init function'
								+ '\n' + `@bypass /function define ${namespaceInfo.name} wilexafixu()`;
							importLines.push(`@bypass /script import function ${namespaceInfo.name} wilexafixu ${initLink}`);
							namespaceInfo.initializeScript
								+= '\n\n' + '@player &aExecuting namespace init function'
								+ '\n' + `@bypass /function execute ${namespaceInfo.name}::wilexafixu()`
								+ '\n' + `@bypass /function remove ${namespaceInfo.name} wilexafixu`;
						}
						else if ((initLink instanceof Error) && (initLink.message === 'Empty file')) {
							emptyFiles.push(`${namespaceInfo.name}/__init__.msc`);
						}
		
						if (emptyFiles.length !== 0) {
							window.showWarningMessage('Cannot upload empty files: ' + emptyFiles.join(', '));
						}
						if (failedUploads.length !== 0) {
							window.showWarningMessage('Failed to find or upload files: ' + failedUploads.join(', '));
						}
						
						let script: string = `@player &aImporting namespace ${namespaceInfo.name}`
							+ '\n\n' + namespaceInfo.defineScript;
						if (importLines.length !== 0) {
							script += '\n\n' + importLines.join('\n');
						}
						if (namespaceInfo.initializeScript.length !== 0) {
							script
								+= '\n\n'
								+ (namespaceInfo.initializeScript.indexOf('(') !== -1 ? '@delay 3s\n' : '')
								+ namespaceInfo.initializeScript;
						}
						return script;
					})
				);
				let finalScript = '';
				for (const script of scripts) {
					finalScript += await script;
					finalScript += '\n\n\n';
				}
				finalScript += '@bypass /script remove interact {{block.getX()}} {{block.getY()}} {{block.getZ()}}';
				finalScript += '\n' + '@player &aNamespace import finished';
				const finalLink: string = await uploadFile(finalScript);
				env.clipboard.writeText(finalLink);
				window.showInformationMessage('Upload finished. Script url was copied to clipboard');
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
