class Store {
    set(key, val) {
        return this._set(key, val ? JSON.stringify(val) : undefined);
    }

    async get(key) {
        const result = await this._get(key);
        return result ? JSON.parse(result) : undefined;
    }

    flush() { }

    close() { }

}
exports.Store = Store;