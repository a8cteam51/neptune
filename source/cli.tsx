#!/usr/bin/env node
import React from 'react';
import {render} from 'ink';
import meow from 'meow';
import {userInfo} from 'node:os';
import App from './app.js';

meow(
	`
	Usage
	  $ neptune
`,
	{importMeta: import.meta},
);

let name: string | undefined;
try {
	name = userInfo().username;
} catch {
	name = undefined;
}

render(<App name={name} />);
