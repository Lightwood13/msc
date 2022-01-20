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

export function activate(context: ExtensionContext) {
	
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
	
	let disposable = commands.registerCommand('msc.upload', async () => {

		const textEditor = window.activeTextEditor;
		
		if (textEditor === undefined)
		{
			window.showErrorMessage('No file open to upload');
			return;
		}
		
		axios({
			httpsAgent: new https.Agent({
				rejectUnauthorized: false
			}),
			url: 'https://paste.minr.org/documents',
			method: 'POST',
			data: textEditor.document.getText()
		})
		.then(data => env.clipboard.writeText('https://paste.minr.org/' + data.data.key))
		.catch(err => console.log(err));

		window.showInformationMessage('Upload finished. Script url was copied to clipboard');
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
		.catch(err => {
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
		// Register the server for plain text documents
		documentSelector: [{ language: 'msc' }],
		synchronize: {
			// Notify the server about file changes to '.clientrc files contained in the workspace
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

	workspace.onDidChangeTextDocument((event) => {
		client.sendNotification('updateDocument', {
			documentUri: event.document.uri.toString(), 
			documentText: event.document.getText()
		});
	});

	// Start the client. This will also launch the server
	client.start();

	client.onReady().then(() => {
		const snippetsUri = Uri.joinPath(context.extensionUri, 'snippets.json');
		workspace.fs.readFile(snippetsUri).then((result) => {
			client.sendNotification('addSnippets', JSON.parse(result.toString()));
		});
		client.onNotification('getDefaultNamespace', () => {
			const defaultNamespaceUri = Uri.joinPath(context.extensionUri, 'resources', 'default.nms');
			workspace.fs.readFile(defaultNamespaceUri).then((result) => {
				client.sendNotification('processDefaultNamespace', result.toString());
			});
		});
	});
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
