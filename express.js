/* global process */
var express = require('express');
var https = require('https');
const { isHeroku } = require('./util');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;

function normalizePath(path) {
    var slash = '/';
    if (path) {
        path = path.trim();
        if (path[0] !== slash) {
            path = slash + path;
        }
    } else {
        path = slash;
    }
    return path;
}

function herokuEnsureHttps(req, res, next) {
    if (req.headers['x-forwarded-proto'] === 'https') {
        return next();
    }
    res.status(404).send('https please');
}

function startPostServer(port, path, options, callback) {
    if (typeof port === 'object') {
        callback = path;
        path = port.path;
    }
    var app = createExpressApp(port, options);
    if (typeof callback === 'object') {
        for (path in callback) {
            app.post(normalizePath(path), callback[path]);
        }
    } else {
        app.post(normalizePath(path), callback);
    }
    return app.startServer();
}

function createExpressApp(port, options) {
    if (!options) {
        options = port;
        port = options.port;
    }
    const app = express();
    const heroku = isHeroku();
    if (heroku) {
        app.use(herokuEnsureHttps);
        port = process.env.PORT;
    }
    app.use(express.urlencoded({ extended: false }));
    app.use(express.json({ strict: false }));
    app.use(express.text({ type: '*/*' }));
    app.startServer = function () {
        const srv = (heroku ? app : https.createServer(options, app)).listen(port);
        console.info('WebHooks server is listening on port', port);
        return srv;
    };
    return app;
}

exports.startPostServer = startPostServer;
exports.createExpressApp = createExpressApp;
exports.normalizePath = normalizePath;
