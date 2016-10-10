"use strict";

var soef = require('soef');

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

var debug = false;
var iCloud = require("find-my-iphone").findmyphone;

iCloud.alertDevice = function(deviceId, message, callback) {
    var options = {
        url: this.base_path + "/fmipservice/client/web/playSound",
        json: {
            "subject": message,
            "device": deviceId
        }
    };
    this.iRequest.post(options, callback);
};


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

var adapter = soef.Adapter (
    main,
    onStateChange,
    {
        name: 'find-my-iphone',
        //discover: function (callback) {
        //},
        //install: function (callback) {
        //},
        uninstall: function (callback) {
        }
        //objectChange: function (id, obj) {
        //}
    }
);

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function onStateChange(id, state) {
    var ar = id.split('.');
    //var dcs = adapter.idToDCS(id);
    var deviceName = ar[2], stateName = ar[3];
    if (stateName == undefined) stateName = deviceName;
    devices.invalidate(id);
    var device = devices.get(deviceName);
    switch (stateName) {
        case 'alert':
            if (device && device.native && device.native.id) {
                var msg = typeof state.val == 'strimg' && state.val != "" ? state.val : 'ioBroker Find my iPhone Alert';
                iCloud.alertDevice(device.native.id, msg, function (err) {
                });
            }
            break;
        case 'refresh':
            updateDevices();
            break;
    }
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function createDevices (cb) {

    var dev = new devices.CDevice(0, '');
    dev.set('refresh', false);
    iCloud.getDevices(function (err, appleDevices) {
        if (err || !appleDevices) return;
        var i = 0;
        function doIt() {
            if (i >= appleDevices.length) {
                devices.update();
                if (cb) cb();
                return;
            }
            var device = appleDevices[i++];
            var dev = new devices.CDevice(0, '');
            dev.setDevice(device.name, {common: {name: device.name, role: 'device'}, native: {id: device.id}});
            //dev.createNew('batteryLevel', )
            dev.set('batteryLevel', device.batteryLevel >> 0 * 100);
            dev.set('lostModeCapable', device.lostModeCapable);
            dev.set('alert', 'ioBroker Find my iPhone Alert');
            if (device.location) {
                dev.set('latitude', device.location.latitude);
                dev.set('longitude', device.location.longitude);
                dev.set('positionType', device.location.positionType);
                dev.set('timeStamp', device.location.timeStamp);
                dev.set('Map-URL', 'http://maps.google.com/maps?z=15&t=m&q=loc:' + device.location.latitude + '+' + device.location.longitude);
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
            } else {
                setTimeout(doIt, 10);
            }

        }
        doIt();
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
    var request = require(__dirname + "/node_modules/find-my-iphone/node_modules/request");
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

function updateDevices() {
    createDevices();
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

