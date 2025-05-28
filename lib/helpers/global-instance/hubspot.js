const { HubSpotAPI } = require('../../hubspot');
module.exports = conf => new HubSpotAPI(conf);