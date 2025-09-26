const { toArray, } = require('../../util');
const { stringify } = require('csv-stringify/sync');

module.exports = {
    convert: async function ({ }, data) {
        console.log(stringify(toArray(data), { header: true }));
        return data;
    }
};
