import { commands, Disposable, ExtensionContext, FileStat, FileType, LogOutputChannel, OutputChannel, Uri, window, workspace } from 'vscode';

import { spawn } from "node:child_process";
import { Writable, WritableOptions } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

let logger: LogOutputChannel;
let _output: OutputChannel;

class Output extends Writable {
	#stringDecoder = new StringDecoder("utf8");

	constructor(opts?: WritableOptions) {
		super(opts);
	}

	override _write(chunk: any, _: BufferEncoding, callback: (error?: Error | null) => void): void {
		if (chunk instanceof Buffer) {
			chunk = this.#stringDecoder.write(chunk);
			chunk += this.#stringDecoder.end();
		}
		_output.append(String(chunk));
		callback();
	}
}

async function findGitRoot(path: Uri): Promise<Uri | undefined> {
	const { uri } = workspace.getWorkspaceFolder(path) ?? {};
	if (!uri) return;
	try {
		if ((await workspace.fs.stat(Uri.joinPath(uri, ".git"))).type === FileType.Directory) {
			return uri;
		} else {
			logger.warn("found .git path in workspace root, but it is not a folder");
		}
	} catch {
	}
}


async function runGitCommand(args: string[], cwd: Uri): Promise<number> {
	logger.debug("running git command: git", args.join(" "), " in cwd: ", cwd.fsPath);
	const child = spawn("git", args, {
		cwd: cwd.fsPath,
		stdio: ["ignore", "pipe", "pipe"],
	});
	child.stdout.pipe(new Output);
	child.stderr.pipe(new Output);

	return new Promise<number>((res, rej) => child.on("exit", (code) => {
		if (code === 0) {
			res(code);
		} else {
			rej(new Error(`git process exited with code: ${code}`));
		}
	}));
}

async function explorer(path: Uri): Promise<true | undefined> {
	if (!(path instanceof Uri)) {
		logger.warn("Path provided is not a URI, got: ", path);
		return;
	}

	const gitRoot = await findGitRoot(path);

	if (!gitRoot) {
		logger.warn("no .git folder found in workspace root");
		return;
	}

	try {
		await runGitCommand(["apply", path.fsPath], gitRoot);
	} catch (e) {
		window.showErrorMessage("Failed to apply patch. Check the Output Channel for more information");
		return;
	}

	logger.info(`Applied patch: ${path} to workspace folder: ${gitRoot}`);

	window.showInformationMessage("Applied Patch");

	return true;
}

const EXT_ID = "apply-patch";

export function activate(context: ExtensionContext) {
	d(logger = window.createOutputChannel("Apply Patch", {
		log: true,
	}));
	d(_output = window.createOutputChannel("Apply Patch - Git Output"));

	c("explorer", explorer);

	function c(name: string, cb: (...args: any[]) => any, thisArg?: any) {
		d(commands.registerCommand(`${EXT_ID}.${name}`, cb, thisArg));
	}
	function d(e: Disposable) {
		context.subscriptions.push(e);
	}
}