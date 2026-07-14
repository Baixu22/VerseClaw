import process from 'node:process';

process.exit(process.cwd() === process.argv[2] ? 0 : 9);
