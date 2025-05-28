const { getGlobal, getEager } = require('../../util');

const PROP_INSTANCES = Symbol();

const getInstances = () => {
    const g = getGlobal();
    let instances = g[PROP_INSTANCES];
    if (!instances) {
        instances = {};
        Object.defineProperty(g, PROP_INSTANCES, { value: instances });
    }
    return instances;
};

const get = async contextFactory => {
    const instances = getInstances();
    let instance = instances[contextFactory];
    if (!instance) {
        let contextConf = getEager(getGlobal(), contextFactory);
        typeof contextConf === 'string' && (contextConf = { name: contextConf });
        instance = instances[contextFactory] = await require(`./${contextConf.name}`)(contextConf);
    }
    return instance;
};

module.exports = { get };