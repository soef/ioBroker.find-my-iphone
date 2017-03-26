"use strict";

var soef = require('soef');

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

var debug = false;
var iCloud = require("find-my-iphone").findmyphone;

//onLogin: function(body, callback) {

iCloud.timedLogout = function (ms) {
    if (this.logoutTimer) {
        clearTimeout(this.logoutTimer);
    }
    if (ms === undefined) ms = 2000;
    this.logoutTimer = setTimeout(function() {
        this.logout();
    }, ms);
};

iCloud.post = function (options, callback) {
    var self = this;
    
    function retry(text) {
        adapter.log.debug('iCloud.post.retry called ' + text);
        self.logout();
        self.init (function () {
            adapter.log.debug('iCloud.post.retry - init callback');
            self.iRequest.post (options, function (err, data) {
                if (err) {
                    adapter.log.error('could not send request. Error: ' + JSON.stringify(err));
                }
                //self.logout ();
                callback && callback ();
                callback = null;
            });
        })
    }
    
    var timer = setTimeout(retry, 5000, 'called from timeout');
    self.iRequest.post(options, function(err, data, body) {
        if (timer) clearTimeout(timer);
        if (err || typeof data !== 'object' || data.statusCode !== 200) {
            adapter.log.debug('First try to send request faild. statusCode=' + (data ? data.statusCode : 'unknown'));
            adapter.log.debug('calling retry...');
            setTimeout(function() {
                retry(' because of error');
            }, 2000);
            return;
        }
        callback && callback(err, data, body);
        callback = null;
    });
};


iCloud.playSound = function(deviceId, message, callback) {
    var options = {
        url: this.base_path + "/fmipservice/client/web/playSound",
        json: {
            "subject": message,
            "device": deviceId
        }
    };
    //this.iRequest.post(options, callback);
    this.post(options, callback);
};

iCloud.sendMessage = function(deviceId, message, sound, callback) {
    if (typeof sound == 'function') {
        callback = sound;
        sound = true;
    }
    var options = {
        url: this.base_path + "/fmipservice/client/web/sendMessage",
        json: {
            "device": deviceId,
            "sound": !!sound,
            "subject": 'ioBroker',
            "userText": true,
            "text": message
        }
    };
    //this.iRequest.post(options, callback);
    this.post(options, callback);
};

iCloud.alertDevice = function(deviceId, message, callback) {
    //this.sendMessage(deviceId, message, true, callback);
    this.playSound(deviceId, message, callback);
};

iCloud.refresh = function(deviceId, callback) {
    if (typeof deviceId == 'function') {
        callback = deviceId;
        deviceId = 'all';
    }
    var options = {
        url: this.base_path + "/fmipservice/client/web/refreshClient",
        json: {
            "clientContext": {

                "appName": "iCloud Find (Web)",
                "appVersion": "2.0",
                "timezone": "Europe/Berlin", //"US/Eastern",
                "inactiveTime": 3571,
                "apiVersion": "3.0",

                "fmly": true,
                "shouldLocate": true,
                "selectedDevice": deviceId
            }
        }
    };
    this.iRequest.post(options, function(err,res) {
        if (err || !res || !res.body || !res.body.content) {
            return callback(err);
        }
        callback(0, res.body.content);
    });
};

iCloud.get = function (callback) {
    this.init(function(err, res, body) {
        if (err || !res || res.statusCode != 200 || !body || !body.content) {
            return callback (err);
        }
        callback(0, body.content);
    });
};

iCloud.logout = function () {
    delete this.jar;
};

iCloud.lostDevice = function(deviceId, ownerNbr, text, emailUpdates, callback) {
    if (typeof emailUpdates == 'function') {
        callback = emailUpdates;
        emailUpdates = false;
    }
    if (typeof text == 'function') {
        callback = text;
        text = null;
    }
    if (typeof ownerNbr == 'function') {
        callback = ownerNbr;
        ownerNbr = null;
    }
    var options = {
        method: "POST",
        url: this.base_path + "/fmipservice/client/web/lostDevice",
        json: {
            "emailUpdates": emailUpdates || false,
            "lostModeEnabled": true,
            "trackingEnabled": true,
            "device": deviceId,
            "passcode": "111111",
            //"userText": false
            "userText": "userText"
        }
    };
    if (typeof ownerNbr === 'object') {
        var o = ownerNbr;
        if (o.ownerNbr) options.json.ownerNbr = o.ownerNbr;
        if (o.passcode) options.json.passcode = o.passcode;
        if (o.text) {
            options.json.text = o.text;
            options.json.userText = true;
        }
    } else {
        if (ownerNbr) options.json.ownerNbr = ownerNbr;
        if (text) {
            options.json.userText = true;
            options.json.text = text;
        }
    }
    //this.iRequest.post(options, callback);
    this.post(options, callback);
};


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

var adapter = soef.Adapter (
    main,
    onStateChange,
    { name: 'find-my-iphone' }
);

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function onStateChange(id, state) {
    var ar = id.split('.');
    //var dcs = adapter.idToDCS(id);
    var deviceName = ar[2], stateName = ar[3];
    devices.invalidate(id);
    var device = devices.get(deviceName);
    switch (stateName || 'root') {
        case 'lost':
            var options, ar;
            ar = state.val.toString().split(';');
            options = { text: ar.shift() };
            if (ar.length) options.ownerNbr = ar.shift();
            if (ar.length) options.passcode = ar.shift();
            iCloud.lostDevice (device.native.id, options, function(err, data) {
            });
            break;
        case 'alert':
            if (device && device.native && device.native.id) {
                var msg = typeof state.val == 'string' && state.val != "" ? state.val : 'ioBroker Find my iPhone Alert';
                iCloud.alertDevice(device.native.id, msg, function (err) {
                });
            }
            break;
        case 'refresh':
            devices.root.setex(id, false);
            if (device && device.native && device.native.id) {
                updateDevice(device.native.id);
            }
            break;
        case 'root':
            switch(deviceName) {
                case 'refresh':
                    //devices.root.set('refresh', false);
                    devices.root.setex(id, false);
                    updateDevice();
                    break;
            }
    }
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function setOurStates(appleDevices, cb) {
    var i = 0;

    function doIt() {
        if (i >= appleDevices.length) {
            devices.update(function() {
                dev = null;
                cb && cb();
            });
            return;
        }
        var device = appleDevices[i++];
        var dev = new devices.CDevice(0, '');
        dev.setDevice(device.name, {common: {name: device.name, role: 'device'}, native: {id: device.id}});
        dev.set('batteryLevel', { val: (device.batteryLevel * 100) >> 0, common: { unit: '%'}});
        dev.set('lostModeCapable', device.lostModeCapable);
        // dev.set('alert', 'ioBroker Find my iPhone Alert');
        // dev.set('lost', { val: '', common: { name: 'Lost Mode', desc: 'Parameter: usertext[;phone number to call[;passcode]'} } );
        dev.createNew('alert', 'ioBroker Find my iPhone Alert');
        dev.createNew('lost', { val: '', common: { name: 'Lost Mode', desc: 'Parameter: usertext[;phone number to call[;passcode]'} } );
        dev.set('refresh', false);
        if (device.location) {
            dev.set('positionType', device.location.positionType);
            dev.set('timeStamp', device.location.timeStamp);
            var tsStr = adapter.formatDate(new Date(device.location.timeStamp), 'YYYY-MM-DD hh:mm:ss');
            dev.set('time', tsStr);

            var changed = dev.set('latitude', device.location.latitude);
            changed |= dev.set('longitude', device.location.longitude);
            if (changed) {
                dev.set('map-url', 'http://maps.google.com/maps?z=15&t=m&q=loc:' + device.location.latitude + '+' + device.location.longitude);
                iCloud.getDistanceOfDevice(device, iCloud.latitude, iCloud.longitude, function (err, result) {
                    if (!err && result && result.distance && result.duration) {
                        dev.set('distance', result.distance.text);
                        dev.set('duration', result.duration.text);
                    }
                    iCloud.getLocationOfDevice(device, function (err, location) {
                        if (!err && result) {
                            dev.set('location', location);
                        }
                        setTimeout(doIt, 10);
                    });
                });
                return;
            }
        }
        setTimeout(doIt, 10);
    }
    doIt();
}

function updateDevice(deviceId, cb) {
    iCloud.refresh(deviceId, function (err, appleDevices) {
        if (err || !appleDevices) return;
        setOurStates(appleDevices, cb);
    });
}


function createDevices (cb) {

    var dev = new devices.CDevice(0, '');
    //dev.set('refresh', { val: false });
    dev.set('refresh', false, 'Refresh all devices');
    iCloud.get(function (err, appleDevices) {
        if (err || !appleDevices) return;
        setOurStates(appleDevices, cb);
    });
}


function decrypt(str) {
    if (!str) str = "";
    try {
        var key = 159;
        var pos = 0;
        var ostr = '';
        while (pos < str.length) {
            ostr = ostr + String.fromCharCode(key ^ str.charCodeAt(pos));
            pos += 1;
        }
        return ostr;
    } catch (ex) {
        return '';
    }
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function normalizeConfig(dev) {
    dev.username = decrypt(dev.username);
    dev.password = decrypt(dev.password);
}

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
                clearTimeout(timeout);
                cb();
            } catch (e) {
            }
        }
    });
}


function main() {
    normalizeConfig(adapter.config);
    iCloud.apple_id = adapter.config.username;
    iCloud.password = adapter.config.password;

    adapter.getForeignObject('system.adapter.javascript.0', function(err, obj) {
        if (!err && obj && obj.native) {
            iCloud.latitude = obj.native.latetude;
            iCloud.longitude = obj.native.longitude;
            createDevices();
        } else {
            iCloud.latitude = 0.0;
            iCloud.longitude = 0.0;
            getLocationByIP(iCloud, createDevices);
        }
    });
    adapter.subscribeStates('*');
}
