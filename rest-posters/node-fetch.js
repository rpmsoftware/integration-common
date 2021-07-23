const fetch = require('node-fetch');
const assert = require('assert');

const fetch2json = async response => {
  assert(response instanceof fetch.Response);
  const { ok } = response;
  const result = await response.text();
  if (ok) {
    try {
      return JSON.parse(result);
    } catch (e) {
      console.error(result);
      throw e;
    }
  }
  try {
    throw JSON.parse(result);
  } catch (e) {
    throw result;
  }
};

function core(url, data, headers) {
  return fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(data)
  }).then(fetch2json);
}

module.exports = function () {
  return core;
};