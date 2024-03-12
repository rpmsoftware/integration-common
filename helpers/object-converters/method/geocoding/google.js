const createGeocoder = require('../../../../geocoding/google');
module.exports = conf => {
    const gc = createGeocoder(conf);
    return () => gc;
};