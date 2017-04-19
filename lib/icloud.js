'use strict';

var request = require('request');
var fs = require('fs');
var uuid = require ('node-uuid');
var osTmpDir = require('os-tmpdir');
var CookieFileStore = require('tough-cookie-filestore');
//var CookieFileStore = requife('tough-cookie-file-store');
//var CookieFileStore = require('file-cookie-store');
//var extend = require('extend');

var log = console.log;

var CLIENT_CONTEXT = 1,
    SERVER_CONTEXT = 2;

function ICloud (appleId, password, timezone) {
    if (!(this instanceof ICloud)) {
        return new ICloud (appleId, password, timezone)
    }
    if (timezone === undefined) timezone = "Europe/Berlin";
    this.authenticated = false;
    this.hsaChallengeRequired = null;
    this.googleTimeout = 3000;
    this.endpoints = {
        home: "https://www.icloud.com",
        setup: "https://setup.icloud.com/setup/ws/1"
    };
    
    this.params = {
        clientBuildNumber: '17BHotfix18',
        clientId: uuid.v1().toUpperCase()
        //clientMasteringNumber: '17BHotfix18'
        //dsid: '0'  // will be set after login
    };
    
    this.serverContext = null;
    
    this.clientContext = function(a, b, c) {
        //return { clientContext: Object.assign( {}, this.clientContext, a, b, c) };
        return Object.assign( {}, this.clientContext, a, b, c);
    };
    this.addClientContext = function (body, a, b, c) {
        body.clientContext = Object.assign ({}, this.clientContext, body.clientContext, a, b , c);
    };
    this.addServerContext = function (body) {
        if (this.serverContext) body.serverContext = this.serverContext;
    };
    
    Object.assign(this.clientContext, {
    // used in initClient, refreshClient, lostDevice
        appName: "iCloud Find (Web)",
        appVersion: "2.0",
        timezone: timezone,
        inactiveTime: 449,
        apiVersion: "3.0",
        deviceListVersion: 1,
        fmly: true
    });

    this.defaults = {
        jar: false,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.79 Safari/537.36 Edge/14.14393',
        qs: this.params,
        json: true,
        headers: {
            'Origin': this.endpoints.home,
            'Referer': this.endpoints.home + '/',
            'User-Agent': this.userAgent,
            /**/'Connection': 'Keep-Alive'
        },
        resolveWithFullResponse: true,
        simple: false,
        method: 'POST'
    };
    
    this.functions = {
        login:                    { endpoint: 'setup',  method: 'POST' },
        logout:                   { endpoint: 'setup',  method: 'GET'  },
        storageUsageInfo:         { endpoint: 'setup',  method: 'POST' },
        refreshWebAuth:           { endpoint: 'push',   method: 'GET'  },
        validate:                 { endpoint: 'setup',  method: 'POST' },
        listDevices:              { endpoint: 'setup',  method: 'GET'  }, // list devices trusted for two-factor authentication
        sendVerificationCode:     { endpoint: 'setup',  method: 'POST' }, // requests that a verification code is sent to the given device
        validateVerificationCode: { endpoint: 'setup',  method: 'POST' }, // verifies a verification code received on a two-factor device
        saveLocFoundPref:         { endpoint: 'setup',  method: 'POST' }, // notification when found!

        initClient:               { endpoint: 'findme', method: 'POST' },
        refreshClient:            { endpoint: 'findme', method: 'POST' },
        playSound:                { endpoint: 'findme', method: 'POST' },
        sendMessage:              { endpoint: 'findme', method: 'POST' },
        lostDevice:               { endpoint: 'findme', method: 'POST', context:CLIENT_CONTEXT|SERVER_CONTEXT },
        getState:                 { endpoint: 'push',   method: 'GET'  },
        mecard:                   { endpoint: 'contacts', method: 'POST' }
    };
    for (var i in this.functions) {
        if (this.functions[i].endpoint === 'setup') this.functions[i].path = this.endpoints.setup + '/' + i;
    }
    
    Object.defineProperty(this, 'requires2fa', { get: function() { return this.hsaChallengeRequired; } });
    this.cookieFilename = osTmpDir() + '/iob-fmip-cookies.json';
    if (typeof appleId === 'object') {
        Object.assign(this, appleId);
    } else {
        this.appleId = appleId;
        this.password = password;
        this.timezone = timezone;
    }
    this.prepareCookies();
}

ICloud.setlog = ICloud.setlog = function(log) {
    log = log;
};

ICloud.prototype.initEndpoints = function(webservices) {
    // for (var service in body.webservices) {
    //     self.endpoints[service] = body.webservices[service].url;
    // }
    var basePath;
    if (!webservices || !webservices.findme || !(basePath = webservices.findme.url)) return false;
    for (var i in this.functions) {
        var func = this.functions[i];
        if (func.endpoint === 'setup') continue;
        if (func.endpoint === 'findme') func.path = basePath + '/fmipservice/client/web/' + i;
        else func.path = webservices[func.endpoint].url + '/' + i;
    }
};

ICloud.prototype.on = function (name, func) {
    if (name === 'error') {
        this.prototype.onError = func.bind(this);
    }
};

ICloud.prototype.once = function (name, func) {
    var self = this;
    if (name === 'error') {
        var oldFunc = this.prototype.onError;
        this.prototype.onError = function(text, code) {
            self.prototype.onError = oldFunc;
            func.call (self, text, code);
        }
    }
};

ICloud.prototype.onError = function (error) {
    // if (error.code == -21669) {
    //     // wrong verification code
    // }
    if (log) log('ICloud.prototype.onError: error=' + error.message + ' (' + error.code + ')');
};

// ICloud.prototype.xrequest = function (endpoint, path, options, callback) {
//     options.uri = options.uri || this.fullEndpoint(endpoint, path);
//     if (options.method === undefined) options.method = 'POST';
//     this._request(options, callback);
// };

ICloud.prototype.error = function (text, code) {
    var err;
    if (typeof text === 'object') err = text;
    else err = new Error (text);
    err.code = code;
    this.lastError = err;
    this.onError(err);
};

ICloud.prototype.start = function (callback) {
    var self = this;
    self.login (function (response) {
        if (self.authenticated) {
            self.initClient (function (appleDevices) {
                callback (appleDevices);
            });
        } else {
            log && log ('not authenticated after login');
        }
    });
};

ICloud.prototype.request = function (path, options, callback) {
    log && log ('ICloud.prototype.request: path=' + path);
    var self = this, func;
    if (typeof path === 'object') {
        callback = options;
        options = path;
        path = options.path;
        delete options.path;
    }
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }
    
    if (!options.uri && !(func = this.functions[path])) return this.error('webervice ' + path + ' not found', -1);
    var params = Object.assign( {}, this.defaults, options);
    if (params.uri === undefined) params.uri = func.path;
    params.method = params.method || func.method || 'POST';
    if (func && (func.context & CLIENT_CONTEXT)) this.addClientContext(params);
    if (func && (func.context & SERVER_CONTEXT)) this.addServerContext(params);
    
    // redirect errors
    params.callback = function (err, res, body) {
        if (err) return self.onError(err);
        if (!res) return self.error(new Error('no response'), -2);
        if (res.statusCode !== 200) {
            var msg = res.statusMessage;
            if (res.body) msg = msg || res.body.reason || res.body.errorReason || res.body.error;
            log && log('ICloud.prototype.request: statusCode=' + res.statusCode + ' ' + (msg ? msg : ''));
            //if (!msg) {
                switch (res.statusCode) {
                    case 450:
                        self.authenticated = false;
                        if (!self.errorCount && params.uri.indexOf('login') < 0) {
                            self.errorCount = self.ErrorCount ? self.ErrorCount + 1 : 1;
                            log && log('ICloud.prototype.request: trying to relogin...');
                            self.start(function(appleDevices) {
                                switch (path) {
                                    case 'initClient':
                                    case 'refreshClient':
                                        return callback && callback(appleDevices);
                                }
                                self.request(path, options, callback);
                            });
                            return;
                        }
                        msg = 'Blocked by Windows Parental Controls (Microsoft)';
                        break;
                    case 421: // Misdirected request
                        if (self.errorCount < 2) break;
                        self.errorCount = self.ErrorCount ? self.ErrorCount + 1 : 1;
                        self.logout(function(res) {
                            self.request(path, options, callback);
                        });
                        break;
                }
            //}
            return self.error(new Error (msg), res.statusCode);
        }
        if (!body) return self.error(new Error('no body'), -3);
        if (body.serverContext) {
            self.serverContext = body.serverContext;
        }
        self.errorCount = 0;
        callback && callback (res, body);
    };
    
    return new request.Request(params);
};

ICloud.prototype.prepareCookies = function(del) {
    // * stores the X-APPLE-WEB-KB cookie so that
    // * subsequent logins will not cause additional e-mails from Apple.
    if (this.cookieFilename) {
        try {
            //fs.writeFileSync (this.cookieFilename, '', { flag: 'wx' } ); // create file if not exist
            fs.writeFileSync (this.cookieFilename, '', { flag: 'a' } ); // create file if not exist
            this.cookieFileStore = new CookieFileStore (this.cookieFilename);
        } catch(e) {
            // * delete cookie file and retry only once
            fs.unlinkSync (this.cookieFilename);
            if (this.cookieFileStore === undefined) {
                this.cookieFileStore = null;
                this.prepareCookies();
            }
        }
    }
    this.defaults.jar = request.jar(this.cookieFileStore);
};

ICloud.prototype.setParams = function(body) {
    // * hsaChallengeRequired is true if two-factor authentication is required.
    this.hsaChallengeRequired = body.hsaChallengeRequired != null;
    if (body.dsInfo && body.dsInfo.dsid != null) {
        this.params.dsid = body.dsInfo.dsid;
    }
    if (body.webservices) {
        this.initEndpoints(body.webservices);
        this.authenticated = true;
    }
};

ICloud.prototype.login = function(callback) {
    var self = this, options = {
        body: {
            ///**/appName: "find",
            apple_id: this.appleId,
            password: this.password,
            extendend_login: false
        }
    };
    self.serverContext = null;
    this.request('login', options, function(response, body) {
        self.setParams(body);
        callback && callback(response);
    });
};

ICloud.prototype.logout = function(callback) {
    var self = this;
    return self.request('logout', function(res) {
        self.serverContext = null;
        self.authenticated = false;
        callback && callback(res);
    });
};


ICloud.prototype.initClient = function(callback) {
    var body =  {
        clientContext: this.clientContext( {
            shouldLocate: true,
            selectedDevice: 'all'
        })
    };
    return this.request('initClient', { body: body }, function (response, body) {
        //if (body.serverContext) this.serverContext = body.serverContext;
        callback && callback (body ? body.content : []);
    }.bind(this));
};

// ICloud.prototype.refreshClient = function(device, callback) {
//     if (typeof device === 'function') {
//         callback = device;
//         device = 'all';
//     }
//     var body = {
//         clientContext: this.clientContext ()
//     };
//     if (device !== 'all' || !this.serverContext) {
//         body.clientContext.selectedDevice = device;
//         body.clientContext.shouldLocate = true;
//     }
//     this.addServerContext(body);
//
//     return this.request('refreshClient', { body: body }, function(response, body) {
//         //if (body.serverContext) self.serverContext = body.serverContext;
//         callback && callback (body ? body.content : []);
//     });
// };


ICloud.prototype.refreshClient = function(device, callback) {
    var shouldLocate = true;
    switch (typeof device) {
        case 'function':
            callback = device;
            device = 'all';
            break;
        case 'object':
            shouldLocate = !!device.shouldLocate;
            device = device.device;
            break;
    }
    var body = {
        clientContext: this.clientContext ()
    };
    //if (device !== 'all' || !this.serverContext) {
    if (device !== 'all' && shouldLocate) {
        body.clientContext.selectedDevice = device;
        body.clientContext.shouldLocate = true;
    }
    this.addServerContext(body);
    
    return this.request('refreshClient', { body: body }, function(response, body) {
        //if (body.serverContext) self.serverContext = body.serverContext;
        callback && callback (body ? body.content : []);
    });
};


ICloud.prototype.refreshClientEx = function(deviceId, callback) {
    var self = this;
    switch (self.authenticated) {
        case undefined:
            break;
        case false:
            self.authenticated = undefined; // only one retry
            self.login (function (response) {
                if (self.authenticated) self.initClient (callback);
            });
            return;
        case true:
            self.refreshClient (deviceId, callback);
    }
};

ICloud.prototype.forEachDevice = function (deviceId, setCallback, readyCallback) {
    if (typeof deviceId === 'function') {
        readyCallback = setCallback;
        setCallback = deviceId;
        deviceId = 'all';
    }
    this.refreshClientEx (deviceId, function(appleDevices) {
        //forEachArrayCallback (appleDevices, devices.update.bind(devices, readyCallback), setCallback);
        //return;
        var i = 0;
        function doIt() {
            if (i >= appleDevices.length) {
                return readyCallback();
            }
            var device = appleDevices[i++];
            if (device) setCallback(device, doIt);
            else setTimeout(doIt, 10);
        }
        doIt();
    })
};


ICloud.prototype.refreshWebAuth = function(callback) {
    return this.request('refreshWebAuth', callback);
};

ICloud.prototype.getState = function(callback) {
    //params: pcsEnabled: true
    return this.request('getState', { body: { pushTopics: [] }}, callback);
};

ICloud.prototype.storageUsageInfo = function(callback) {
    return this.request('storageUsageInfo', callback);
};

ICloud.prototype.mecard = function(callback) {
    return this.request('mecard', callback);
};

ICloud.prototype.validate = function(callback) {
    return this.request('validate', function(res, body) {
        this.setParams(body);
        callback && callback(res, body);
    }.bind(this));
};

// does nor work!!!
ICloud.prototype.listDevices = function(callback) {
    // list devices trusted for two-factor authentication
    return this.request('listDevices', callback);
};

ICloud.prototype.sendVerificationCode = function(device, callback) {
    // requests that a verification code is sent to the given device
    return this.request('sendVerificationCode', { body: device }, callback);
};


ICloud.prototype.version = function(device, callback) {
    return this.request({ uri: 'https://www.icloud.com/system/cloudos/current/version.json' }, callback);
    //{"buildNumber":"17BHotfix5","autoUpdate":"3"}
};


ICloud.prototype.validateVerificationCode = function(device, code, callback) {
    // verifies a verification code received on a two-factor device
    var body = {
        verificationCode: code,
        trustBrowser: ture,
        device: device  // ???
    };
    return this.request ('validateVerificationCode', {body: body}, callback);
    // if (error.code == -21669) {
    //     // wrong verification code
    // }
};

ICloud.prototype.playSound = function(body, callback) {
    body = Object.assign( {
            clientContext: {
                fmly: true
            }
            //,mailUpdates: true
        },
        body
    );
    return this.request ('playSound', { body: body }, callback);
};

ICloud.prototype.alertDevice = function (device, subject, callback) {
    this.playSound( { device: device, subject: subject }, callback);
};

ICloud.prototype.sendMessage = function(body, subject, text, sound, callback) {
    if (typeof body !== 'object') {
        body = { device: body, subject: subject };
        if (typeof text === 'string') body.text = text;
        if (typeof text === 'boolean') body.sound = text;
        var len = arguments.length;
        callback = arguments[--len];
        var bo = arguments[--len];
        if (typeof bo === 'boolean') body.sound = bo;
    }
    body.userText = !!body.text;
    //body.vibrate = true;
    //body.strobe = true;
    return this.request ('sendMessage', { body: body }, callback);
};


function getCallback(args) {
    var callback;
    if (typeof (callback = args[args.len-1]) === 'function') {
        args.len -= 1;
        args[args.len] = undefined;
        return callback;
    }
}


ICloud.prototype.lostDevice = function(device, ownerNbr, text, passcode, emailUpdates, callback) {
    var body, len = arguments.length-1;
    callback = arguments[len];
    if (typeof callback === 'function') arguments[len--] = undefined;
    if (typeof (body = arguments[len]) !== 'object') body = {};
    else arguments[len] = undefined;
    
    if (arguments[0]) body.device = arguments[0];
    if (arguments[1]) body.ownerNbr = arguments[1];
    if (arguments[2]) body.text = arguments[2];
    if (arguments[3]) body.passcode = arguments[3];
    
    if (body.emailUpdates === undefined) body.emailUpdates = !!emailUpdates;
    if (body.lostModeEnabled === undefined) body.lostModeEnabled = true;
    if (body.trackingEnabled === undefined) body.trackingEnabled = true;
    if (body.sound === undefined) body.sound = true;
    //body.passcode = '1111';
    
    body.userText = !!body.text;
    //this.addClientContext(body);
    //this.addServerContext(body);
    
    return this.request ('lostDevice', { body: body }, callback);
};

ICloud.prototype.stopLostMode = function (device, callback) {
    if (typeof device !== 'object') {
        device = { device: device };
    }
    device.lostModeEnabled = true;
    device.trackingEnabled = false;
    //device.authToken = null;
    device.emailUpdates = false;
    device.userText = false;
    this.lostDevice(device, callback);
};


var lostDevice = {
// verloren stoppen ausstehend
    //creationTimestamp
    statusCode: "205",  // 2201 -> done (ok)
    stopLostMode: true
};

var lostDevice = {
    "stopLostMode": false,
    "emailUpdates": true,
    "userText": true,
    "sound": false,
    "ownerNbr": "",
    "text": "Pause, L E O N!!",
    "createTimestamp": 1492352746731,
    "statusCode": "2200"
};


ICloud.prototype.saveLocFoundPref = function(device, how, callback) {
    // bei Fund Benachrichtigung
    var body = { device: device, locFoundEnabled: !!how };
    return this.request('sendVerificationCode', { body: body }, callback);
};

ICloud.prototype.signin = function(device, callback) {
    var options = {
        uri: 'https://idmsa.apple.com/appleauth/auth/signin',
        body: {
            accountName: this.appleId,
            password: this.password,
            rememberMe: false,
            trustTokens: []
        }
    };
    return this.request(options, function(res, body) {
        if (res.headers.Header.X-Apple-Session-Token) {
        }
    });
};

// Experimental
ICloud.prototype.accountLogin = function(token, callback) {
    var body = typeof token === 'object' ? token : {
        dsWebAuthToken: token
        // accountName: this.appleId,
        // password: this.password,
        // rememberMe: false,
        // trustTokens: []
    };
    var options = {
        uri: 'https://setup.icloud.com/setup/ws/1/accountLogin',
        body: body
    };
    return this.request(options, function(res, body) {
        if (res.headers.Header.X-Apple-Session-Token) {
        }
    });
};

ICloud.prototype.getAddressOfLocation = function (device, callback) {
    
    if (!device.location) return callback("device has no location");
    
    var location = device.location.latitude.toString() + '.' + device.location.longitude;
    var req = {
        url: 'http://maps.googleapis.com/maps/api/geocode/json?latlng=' + location + '&sensor=true',
        json: true,
        timeout: this.googleTimeout
    };
    
    request(req, function(err, res, body) {
        if (err || res.statusCode !== 200) return callback (err || ('statusCode' + res.statusCode));
        if (Array.isArray(body.results) && body.results.length > 0 && body.results[0].formatted_address) {
            callback (err, body.results[0].formatted_address);
        }
    });
};


function getLocationByIP(obj, cb) {
    var timeout = setTimeout(cb, 3000);
    //var request = require(__dirname + "/node_modules/find-my-iphone/node_modules/request");
    var request = require("request");
    request.get({ url: "http://freegeoip.net/json/" }, function (err, res) {
        if (!err && res && res.body) {
            try {
                var json = JSON.parse(res.body);
                obj.longitude = json.longitude;
                obj.latidude = json.latitude;
                if (obj.setOwnLocation) obj.setOwnLocation(json.longitude, json.latitude);
                clearTimeout(timeout);
                cb && cb();
            } catch (e) {
            }
        }
    });
}


ICloud.prototype.setOwnLocation = function (location, callback) {
    
    function cb() {
        callback && callback();
        callback = null;
    }
    
    if (typeof location === 'object') {
        this.ownLocation = Object.assign({}, location);
        this.ownLocation.str = location.latitude.toString () + '.' + location.longitude;
        return cb();
    }
    this.setOwnLocation( { latitude: 0.0, longitude: 0.0} );
    var self = this;
    var timeout = setTimeout(cb, 3000);
    request.get( { url: "http://freegeoip.net/json/" }, function (err, res) {
        if (!err && res && res.body) {
            try {
                var json = JSON.parse(res.body);
                self.setOwnLocation (json);
            } catch (e) {
            } finally {
                clearTimeout(timeout);
                cb();
            }
        }
    });
};


ICloud.prototype.getDistance = function(device, callback) {
    if (!device.location) return callback("device has no location");
    if (!this.ownLocation) return callback ('ownLocation ist unknown');
    var location = device.location.latitude.toString() + '.' + device.location.longitude;
    var req = {
        url: 'http://maps.googleapis.com/maps/api/distancematrix/json?origins=' + location + '&destinations=' + this.ownLocation.str + '&mode=driving&sensor=false',
        json: true,
        timeout: this.googleTimeout
    };
    
    request(req, function(err, res, body) {
        if (err || res.statusCode !== 200) return callback (err || ('statusCode' + res.statusCode));
        if (body && body.rows && body.rows.length > 0) {
            return callback(err, body.rows[0].elements[0]);
        }
    });
};

module.exports = ICloud;


