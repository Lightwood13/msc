import * as vscode from 'vscode';
import axios from 'axios';


export function activate(context: vscode.ExtensionContext) {
	
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
	const https = require('https');
	
	let disposable = vscode.commands.registerCommand('msc.upload', async () => {

		const textEditor = vscode.window.activeTextEditor;
		
		if (textEditor === undefined)
		{
			vscode.window.showErrorMessage('No file open to upload');
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
		.then(data => vscode.env.clipboard.writeText('https://paste.minr.org/' + data.data.key))
		.catch(err => console.log(err));

		vscode.window.showInformationMessage('Upload finished. Script url was copied to clipboard');
	});
	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerCommand('msc.download', async () => {

		let clipboardText = await vscode.env.clipboard.readText();
		if (clipboardText.length === 0)
		{
			vscode.window.showErrorMessage('Clipboard is empty. Please copy script url to clipboard');
			return;
		}
		
		const scriptName = clipboardText.substring(23);
		if (scriptName.length === 0)
		{
			vscode.window.showErrorMessage('Please copy a valid script URL to clipboard');
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
			const document = await vscode.workspace.openTextDocument({'language': 'msc', 'content': data.data.data});
		})
		.catch(err => {
			vscode.window.showErrorMessage('Cannot get requested script. Please copy a valid script URL to clipboard');
		});
	});
	context.subscriptions.push(disposable);
}

export function deactivate() {}
