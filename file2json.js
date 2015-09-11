console.log(JSON.stringify({ value: require('fs').readFileSync(process.argv[2], 'ascii') }));
