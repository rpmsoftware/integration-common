const { validateString, toArray, getEager, normalizeInteger, createParallelRunner } = require('../../../util');
const assert = require('assert');

const SOURCES = {
    customers: async function () {
        return (await this.getCustomers()).Customers.map(({ CustomerID }) => ({ CustomerID }));
    },

    suppliers: async function () {
        return (await this.getSuppliers(true)).Suppliers.map(({ SupplierID }) => ({ SupplierID }));
    }
};

const DEFAULT_PARALLEL = 10;

module.exports = {
    init: async function ({ parallel, dstProperty, source, modifiedAfter }) {
        if (source || (source = undefined)) {
            source = validateString(source).trim().toLowerCase();
            getEager(SOURCES, source);
        }
        modifiedAfter = modifiedAfter ? validateString(modifiedAfter) : undefined;
        validateString(dstProperty);
        parallel = parallel === undefined ? DEFAULT_PARALLEL : normalizeInteger(parallel);
        assert(parallel > 0);
        return { source, modifiedAfter, dstProperty };
    },

    convert: async function ({ parallel, source, modifiedAfter, dstProperty }, data) {
        const array = toArray(data);
        if (array.length > 0) {
            const { api } = this;
            let r;
            if (source) {
                r = await SOURCES[source].call(api);
                const runner = createParallelRunner(parallel);
                r = await Promise.all(r.map(o => {
                    o.ModifiedAfter = modifiedAfter;
                    return runner(() => api.getAccounts(o));
                }));
                r = r.reduce((p, c) => p.concat(c.Accounts), []);
            } else {
                r = (await api.getAccounts(modifiedAfter)).Accounts;
            }
            array.forEach(e => e[dstProperty] = r);
        }
        return data;
    }
};