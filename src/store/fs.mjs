import { statSync, mkdirSync, writeFileSync, unlinkSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Store } from './common.mjs';
import { format } from 'util';

const PATTERN = /^\.keyvaluestore_.+$/;
const ENCODING = 'utf8';
const DEFAULT_DIR = '.keyvaluestore';

class FsClient extends Store {

    constructor(dir) {
        super();
        dir = dir || join(homedir(), DEFAULT_DIR);
        try {
            if (!statSync(dir).isDirectory()) {
                throw new Error(`"${dir}" has to be a directory`);
            }
        } catch (err) {
            if (err.code !== 'ENOENT') {
                throw err;
            }
            mkdirSync(dir);
        }
        this.dir = dir;
    }

    getFileName(key) {
        return join(this.dir, format('.keyvaluestore_%s', key));
    }

    _set(key, val) {
        const path = this.getFileName(key);
        val ? writeFileSync(path, val, ENCODING) : unlinkSync(path);
    }

    _get(key) {
        try {
            return readFileSync(this.getFileName(key), ENCODING);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                throw err;
            }
        }
    }

    flush() {
        readdirSync(this.dir).forEach(f => PATTERN.test(f) && unlinkSync(join(this.dir, f)));
    }
}

export default function ({ dir }) {
    return new FsClient(dir);
};
