/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as path from 'path';
import { commands, window, env, workspace, ExtensionContext, Uri } from 'vscode';
import axios from 'axios';
import * as https from 'https';

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient;

interface DocumentContents {
	text: string,
	uri: Uri
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
	document: DocumentContents,
	defineScript: string,
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

async function findAndUploadFile(fileName: string): Promise<string | undefined> {
	const files: Uri[] = await workspace.findFiles(escapeArrayAccess(fileName));
	if (files.length === 0)
		return undefined;
	const fileContents: Uint8Array = await workspace.fs.readFile(files[0]);
	return await uploadFile(fileContents.toString());
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

		if (textEditor.document.languageId === 'nms')
			client.sendNotification('Export namespace', {
				text: textEditor.document.getText(),
				uri: textEditor.document.uri
			});
		else {
			const result: string = await uploadFile(textEditor.document.getText());
			env.clipboard.writeText(result);
			window.showInformationMessage('Upload finished. Script url was copied to clipboard');
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
		client.onNotification('Upload namespace script', async (namespaceInfo: NamespaceUploadResult) => {
			
			const lines: string[] = [];

			for (const functionInfo of namespaceInfo.functions) {
				const functionLink: string | undefined = await findAndUploadFile(
					`${functionInfo.namespaceName}/${functionInfo.functionName}.msc`
				);
				if (functionLink !== undefined)
					lines.push(`@bypass /script import function ${functionInfo.namespaceName} ${functionInfo.functionName} ${functionLink}`);
			}
			for (const constructorInfo of namespaceInfo.constructors) {
				const constructorLink: string | undefined = await findAndUploadFile(
					`${constructorInfo.namespaceName}/${constructorInfo.className}/${constructorInfo.constructorSignature}.msc`
				);
				if (constructorLink !== undefined)
					lines.push(`@bypass /script import constructor ${constructorInfo.namespaceName} ${constructorInfo.constructorSignature} ${constructorLink}`);
			}
			for (const methodInfo of namespaceInfo.methods) {
				const methodLink: string | undefined = await findAndUploadFile(
					`${methodInfo.namespaceName}/${methodInfo.className}/${methodInfo.methodName}.msc`
				);
				if (methodLink !== undefined)
					lines.push(`@bypass /script import method ${methodInfo.namespaceName} ${methodInfo.className} ${methodInfo.methodName} ${methodLink}`);
			}
			lines.push('@bypass /script remove interact {{block.getX()}} {{block.getY()}} {{block.getZ()}}');

			const script: string = namespaceInfo.defineScript + '\n' + lines.join('\n');
			const finalLink: string = await uploadFile(script);
			env.clipboard.writeText(finalLink);
			window.showInformationMessage('Upload finished. Script url was copied to clipboard');
		});
		const snippetsUri = Uri.joinPath(context.extensionUri, 'snippets.json');
		workspace.fs.readFile(snippetsUri).then((result) => {
			client.sendNotification('addSnippets', JSON.parse(result.toString()));
		});
	});
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
