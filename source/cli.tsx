#!/usr/bin/env node
import React from 'react';
import {render} from 'ink';
import meow from 'meow';
import {userInfo} from 'node:os';
import {resolve} from 'node:path';
import App from './app.js';

const cli = meow(
	`
	Usage
	  $ neptune [options]

	Options
	  --cwd <path>   Auto-load the project at <path> if it has a neptune-config.json.
	  --version      Print the version and exit.
	  --help         Print this help.
`,
	{
		importMeta: import.meta,
		flags: {
			cwd: {type: 'string'},
		},
	},
);

let name: string | undefined;
try {
	name = userInfo().username;
} catch {
	name = undefined;
}

const startCwd = cli.flags.cwd ? resolve(cli.flags.cwd) : undefined;

render(<App name={name} startCwd={startCwd} />);
