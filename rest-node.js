const client = new (require('node-rest-client').Client)();
module.exports = function (url, data, headers) {
  return new Promise(resolve => {
    client.post(url, { headers, data }, resolve);
  });
};

