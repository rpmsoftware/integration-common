const { init } = require('./update-basic-entity');
const { ObjectType } = require('../../api-enums');

module.exports = {
    init: async function (conf) {
        conf = await init.call(this, Object.assign({}, conf, { type: ObjectType.Customer }));
        conf.name = 'update-basic-entity';
        return conf
    },
    convert: function () {
        throw 'Never happens'
    }
};
