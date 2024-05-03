const HerokuApi = require('../../../heroku-api');

module.exports = conf => {
    const gc = new HerokuApi(conf);
    return () => gc;
};