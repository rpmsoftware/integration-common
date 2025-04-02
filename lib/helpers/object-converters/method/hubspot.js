const { HubSpotAPI } = require('../../../hubspot');

module.exports = conf => {
    const api = new HubSpotAPI(conf);
    return () => api;
};