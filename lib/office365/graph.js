const { createOutlookTokenFactory } = require('./lib');
const MicrosoftGraph = require("@microsoft/microsoft-graph-client");

exports.createClient = config => {
    const createToken = createOutlookTokenFactory(config);
    return MicrosoftGraph.Client.init({
        defaultVersion: 'v1.0',
        authProvider: done => createToken().then(token => done(undefined, token), done),
        debugLogging: !!config.debugLogging
    });

}

