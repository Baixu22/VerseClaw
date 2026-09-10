import { realpathSync } from 'node:fs';
import process from 'node:process';

// Compare realpaths: the harness runner spawns with cwd derived from
// import.meta.url (node realpath-resolves module URLs), so on a checkout
// reached through a directory junction the two paths are spelled differently
// but denote the same directory.
process.exit(realpathSync(process.cwd()) === realpathSync(process.argv[2]) ? 0 : 9);
