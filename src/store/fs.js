const fs = require('fs');
const { join } = require('path');
const { homedir } = require('os');
const format = require('util').format.bind(undefined, '.keyvaluestore_%s');
const PATTERN = /^\.keyvaluestore_.+$/;

const ENCODING = 'utf8';
const DEFAULT_DIR = '.keyvaluestore';

class FsClient extends require('./common').Store {

    constructor(dir) {
        super();
        dir = dir || join(homedir(), DEFAULT_DIR);
        try {
            if (!fs.statSync(dir).isDirectory()) {
                throw new Error(`"${dir}" has to be a directory`);
            }
        } catch (err) {
            if (err.code !== 'ENOENT') {
                throw err;
            }
            fs.mkdirSync(dir);
        }
        this.dir = dir;
    }

    getFileName(key) {
        return join(this.dir, format(key));
    }

    _set(key, val) {
        const path = this.getFileName(key);
        val ? fs.writeFileSync(path, val, ENCODING) : fs.unlinkSync(path);
    }

    _get(key) {
        try {
            return fs.readFileSync(this.getFileName(key), ENCODING);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                throw err;
            }
        }
    }

    flush() {
        fs.readdirSync(this.dir).forEach(f => PATTERN.test(f) && fs.unlinkSync(join(this.dir, f)));
    }
}

module.exports = function ({ dir }) {
    return new FsClient(dir);
};
