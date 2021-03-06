/**
 * The Sinon "server" mimics a web server that receives requests from
 * sinon.FakeXMLHttpRequest and provides an API to respond to those requests,
 * both synchronously and asynchronously. To respond synchronuously, canned
 * answers have to be provided upfront.
 *
 * @author Christian Johansen (christian@cjohansen.no)
 * @license BSD
 *
 * Copyright (c) 2010-2013 Christian Johansen
 */
"use strict";

var push = [].push;
var sinon = require("./core");
var createInstance = require("./core/create");
var format = require("./core/format");
var configureLogError = require("./core/log_error");

function responseArray(handler) {
    var response = handler;

    if (Object.prototype.toString.call(handler) !== "[object Array]") {
        response = [200, {}, handler];
    }

    if (typeof response[2] !== "string") {
        throw new TypeError("Fake server response body should be string, but was " +
                            typeof response[2]);
    }

    return response;
}

var wloc = typeof window !== "undefined" ? window.location : { "host": "localhost", "protocol": "http"};
var rCurrLoc = new RegExp("^" + wloc.protocol + "//" + wloc.host);

function matchOne(response, reqMethod, reqUrl) {
    var rmeth = response.method;
    var matchMethod = !rmeth || rmeth.toLowerCase() === reqMethod.toLowerCase();
    var url = response.url;
    var matchUrl = !url || url === reqUrl || (typeof url.test === "function" && url.test(reqUrl));

    return matchMethod && matchUrl;
}

function match(response, request) {
    var requestUrl = request.url;

    if (!/^https?:\/\//.test(requestUrl) || rCurrLoc.test(requestUrl)) {
        requestUrl = requestUrl.replace(rCurrLoc, "");
    }

    if (matchOne(response, this.getHTTPMethod(request), requestUrl)) {
        if (typeof response.response === "function") {
            var ru = response.url;
            var args = [request].concat(ru && typeof ru.exec === "function" ? ru.exec(requestUrl).slice(1) : []);
            return response.response.apply(response, args);
        }

        return true;
    }

    return false;
}

var fakeServer = {
    create: function (config) {
        var server = createInstance(this);
        server.configure(config);
        if (!sinon.xhr.supportsCORS) {
            this.xhr = sinon.useFakeXDomainRequest();
        } else {
            this.xhr = sinon.useFakeXMLHttpRequest();
        }
        server.requests = [];

        this.xhr.onCreate = function (xhrObj) {
            server.addRequest(xhrObj);
        };

        return server;
    },

    configure: function (config) {
        var whitelist = {
            "autoRespond": true,
            "autoRespondAfter": true,
            "respondImmediately": true,
            "fakeHTTPMethods": true,
            "logger": true
        };
        var setting;

        config = config || {};
        for (setting in config) {
            if (whitelist.hasOwnProperty(setting) && config.hasOwnProperty(setting)) {
                this[setting] = config[setting];
            }
        }
        this.logError = configureLogError(config);
    },

    addRequest: function addRequest(xhrObj) {
        var server = this;
        push.call(this.requests, xhrObj);

        xhrObj.onSend = function () {
            server.handleRequest(this);

            if (server.respondImmediately) {
                server.respond();
            } else if (server.autoRespond && !server.responding) {
                setTimeout(function () {
                    server.responding = false;
                    server.respond();
                }, server.autoRespondAfter || 10);

                server.responding = true;
            }
        };
    },

    getHTTPMethod: function getHTTPMethod(request) {
        if (this.fakeHTTPMethods && /post/i.test(request.method)) {
            var matches = (request.requestBody || "").match(/_method=([^\b;]+)/);
            return matches ? matches[1] : request.method;
        }

        return request.method;
    },

    handleRequest: function handleRequest(xhr) {
        if (xhr.async) {
            if (!this.queue) {
                this.queue = [];
            }

            push.call(this.queue, xhr);
        } else {
            this.processRequest(xhr);
        }
    },

    logger: function () {
        // no-op; override via configure()
    },

    logError: configureLogError({}),

    log: function log(response, request) {
        var str;

        str = "Request:\n" + format(request) + "\n\n";
        str += "Response:\n" + format(response) + "\n\n";

        if (typeof this.logger === "function") {
            this.logger(str);
        }
    },

    respondWith: function respondWith(method, url, body) {
        if (arguments.length === 1 && typeof method !== "function") {
            this.response = responseArray(method);
            return;
        }

        if (!this.responses) {
            this.responses = [];
        }

        if (arguments.length === 1) {
            body = method;
            url = method = null;
        }

        if (arguments.length === 2) {
            body = url;
            url = method;
            method = null;
        }

        push.call(this.responses, {
            method: method,
            url: url,
            response: typeof body === "function" ? body : responseArray(body)
        });
    },

    respond: function respond() {
        if (arguments.length > 0) {
            this.respondWith.apply(this, arguments);
        }

        var queue = this.queue || [];
        var requests = queue.splice(0, queue.length);

        for (var i = 0; i < requests.length; i++) {
            this.processRequest(requests[i]);
        }
    },

    processRequest: function processRequest(request) {
        try {
            if (request.aborted) {
                return;
            }

            var response = this.response || [404, {}, ""];

            if (this.responses) {
                for (var l = this.responses.length, i = l - 1; i >= 0; i--) {
                    if (match.call(this, this.responses[i], request)) {
                        response = this.responses[i].response;
                        break;
                    }
                }
            }

            if (request.readyState !== 4) {
                this.log(response, request);

                request.respond(response[0], response[1], response[2]);
            }
        } catch (e) {
            this.logError("Fake server request processing", e);
        }
    },

    restore: function restore() {
        return this.xhr.restore && this.xhr.restore.apply(this.xhr, arguments);
    }
};

module.exports = fakeServer;
